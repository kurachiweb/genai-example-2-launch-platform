import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  ProductLifecycleCommitter,
  ProductMessagePublisher,
} from './ports.ts';
import { productError } from './product-errors.ts';
import { dispatchProductLifecycleEvent } from './product-lifecycle-dispatch.ts';
import { PRODUCT_TYPES } from './product-types.ts';

export type VisibilityChangeResult = 'changed' | 'unchanged';

// 操作の権限・理由・監査ログ・通知は呼び出し側(運営者の操作)が持ち、本操作口は呼び出し元の主体を判定しない
export interface ProductVisibilityControl {
  // 論理削除済み・存在しないプロダクトはproductError('product_not_found')を投げ、既に同じ状態ならunchangedを返す
  hide(productId: string, at: Date): Promise<VisibilityChangeResult>;
  // 非公開化で取り消したローンチは戻さない
  unhide(productId: string, at: Date): Promise<VisibilityChangeResult>;
}

@injectable()
export class StoreProductVisibilityControl implements ProductVisibilityControl {
  constructor(
    @inject(PRODUCT_TYPES.ProductLifecycleCommitter)
    private readonly committer: ProductLifecycleCommitter,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: ProductMessagePublisher,
  ) {}

  hide(productId: string, at: Date): Promise<VisibilityChangeResult> {
    return this.#transit('hidden', productId, at);
  }

  unhide(productId: string, at: Date): Promise<VisibilityChangeResult> {
    return this.#transit('unhidden', productId, at);
  }

  async #transit(
    type: 'hidden' | 'unhidden',
    productId: string,
    at: Date,
  ): Promise<VisibilityChangeResult> {
    const result = await this.committer.commit({ type, productId, at });
    switch (result.kind) {
      case 'unchanged':
        return 'unchanged';
      case 'rejected':
        if (result.reason === 'not-found') {
          throw productError('product_not_found');
        }
        // 非公開化・復元の確定は版・投稿者の状態・固定を条件にしない
        throw new Error(
          'プロダクトの非公開化・復元の確定が想定外の理由で取り消されました',
        );
      case 'committed':
        await dispatchProductLifecycleEvent(this.publisher, result.event);
        return 'changed';
    }
  }
}
