import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../../lib/core/messaging/contracts/product.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductLifecycleStore } from '../../../lib/core/product/ports.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { ProductMessagePublisher } from './ports.ts';

export const OWNED_PRODUCT_BATCH_SIZE = 50;

export const PRODUCT_ERASURE_WAIT_LIMIT_MS = 10 * 60 * 1000;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

const logger = getAppLogger(['event', 'product', 'lifecycle']);

// プロダクトの行の物理削除はプロダクトライフサイクルの実行器が行うため、この処理は行が無くなるまで続きを返して待つ。
// 対象を呼び出しのたびにD1から求め直し、作成済みのイベントは作り直さないため、再試行・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class UserProductErasureHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductLifecycleStore)
    private readonly lifecycle: ProductLifecycleStore,
    @inject(PLATFORM_TYPES.MessagePublisher)
    private readonly publisher: ProductMessagePublisher,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const productIds = await this.lifecycle.listOwnedProductIds(
      event.userId,
      OWNED_PRODUCT_BATCH_SIZE,
    );
    if (productIds.length === 0) {
      return DONE;
    }
    const now = this.clock.now();
    const createdAt = await this.lifecycle.purgeDueCreatedAt(productIds);
    const unstarted = productIds.filter((id) => !createdAt.has(id));
    if (unstarted.length > 0) {
      const created = await this.lifecycle.createPurgeDueEvents(unstarted, now);
      await this.#publishAll(created);
      return CONTINUE;
    }
    // 5秒ごとの続きの空回りを避け、滞ったプロダクトの物理削除をアカウント機能の再試行の間隔とデッドレターの通知に任せる
    const latest = Math.max(
      ...[...createdAt.values()].map((at) => at.getTime()),
    );
    if (now.getTime() - latest >= PRODUCT_ERASURE_WAIT_LIMIT_MS) {
      throw new Error(
        `利用者のプロダクトの物理削除が、全ての開始から${String(PRODUCT_ERASURE_WAIT_LIMIT_MS / 60_000)}分を過ぎても終わっていません(${String(productIds.length)}件)`,
      );
    }
    return CONTINUE;
  }

  // 送れなかったイベントはpendingのまま残り日次の送り直しが送るため、残りの送信を止めない
  async #publishAll(events: readonly ProductLifecycleEvent[]): Promise<void> {
    for (const event of events) {
      try {
        await this.publisher.publish(RUN_PRODUCT_LIFECYCLE_MESSAGE, {
          eventId: event.id,
        });
      } catch (error: unknown) {
        logger.error(
          'プロダクトライフサイクルイベントの送信を要求できませんでした',
          { error, eventId: event.id, productId: event.productId },
        );
      }
    }
  }
}
