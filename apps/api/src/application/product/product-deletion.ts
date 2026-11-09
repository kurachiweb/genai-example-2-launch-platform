import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AppError } from '../../../lib/core/errors/app-error.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  ProductLifecycleCommitter,
  ProductLifecycleRejection,
  ProductMessagePublisher,
  ProductStore,
} from './ports.ts';
import { productError } from './product-errors.ts';
import { dispatchProductLifecycleEvent } from './product-lifecycle-dispatch.ts';
import type { ProductStateEvaluator } from './product-state-evaluator.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export interface ProductDeletionInput {
  // 編集画面を開いたハンドル
  readonly productHandle: string;
  readonly expectedVersion: number;
}

export interface ProductDeletion {
  delete(user: CurrentUser, input: ProductDeletionInput): Promise<void>;
}

const COMMIT_REJECTIONS: Readonly<
  Record<ProductLifecycleRejection, () => AppError>
> = Object.freeze({
  'not-found': () => productError('product_not_found'),
  conflict: () => productError('product_update_conflict'),
  locked: () => productError('product_locked'),
  'account-unavailable': () => productError('account_unavailable'),
});

// 利用者が停止中・退会済みでないことはリゾルバが確かめ、書き込みの時点の投稿者の状態・版・予選の固定は確定の一括の書き込みが条件にする
@injectable()
export class StoreProductDeletion implements ProductDeletion {
  constructor(
    @inject(PRODUCT_TYPES.ProductStore) private readonly store: ProductStore,
    @inject(PRODUCT_TYPES.ProductStateEvaluator)
    private readonly evaluator: ProductStateEvaluator,
    @inject(PRODUCT_TYPES.ProductLifecycleCommitter)
    private readonly committer: ProductLifecycleCommitter,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: ProductMessagePublisher,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async delete(user: CurrentUser, input: ProductDeletionInput): Promise<void> {
    const now = this.clock.now();
    const snapshot = await this.store.findForOwner(
      user.user.id,
      input.productHandle,
      now,
    );
    if (snapshot === undefined) {
      throw productError('product_not_found');
    }
    if (snapshot.version !== input.expectedVersion) {
      throw productError('product_update_conflict');
    }
    const states = await this.evaluator.evaluate({
      ownerUserId: snapshot.ownerUserId,
      products: [
        {
          productId: snapshot.productId,
          hidden: snapshot.hidden,
          launches: snapshot.launches,
        },
      ],
      at: now,
    });
    const locks = states.get(snapshot.productId)?.locks;
    if (locks === undefined) {
      throw new Error('削除するプロダクトの状態を判定できませんでした');
    }
    if (locks.locked) {
      throw productError('product_locked');
    }
    if (locks.unknown) {
      throw productError('decision_unavailable');
    }
    const result = await this.committer.commit({
      type: 'deleted',
      productId: snapshot.productId,
      expectedVersion: input.expectedVersion,
      at: now,
    });
    if (result.kind === 'rejected') {
      throw COMMIT_REJECTIONS[result.reason]();
    }
    if (result.kind === 'unchanged') {
      throw new Error('プロダクトの削除の確定が想定外の結果を返しました');
    }
    await dispatchProductLifecycleEvent(this.publisher, result.event);
  }
}
