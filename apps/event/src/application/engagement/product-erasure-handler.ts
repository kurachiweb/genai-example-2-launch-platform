import { inject, injectable } from 'inversify';

import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { EngagementErasureStore } from '../../../lib/core/engagement/ports.ts';
import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';

export const PRODUCT_ERASURE_BATCH_SIZE = 500;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// launch_comments・product_ratingsがproducts・product_launchesを外部キーで参照するため、実行器がプロダクトの行を物理削除する前に、他の利用者のものを含む評価とコメントを消し切る。
// 残りは同じ一括の書き込みの後に読み直した有無で判定し、毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class ProductErasureHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(ENGAGEMENT_PLATFORM_TYPES.EngagementErasureStore)
    private readonly store: EngagementErasureStore,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const { remaining } = await this.store.eraseProduct({
      productId: event.productId,
      limit: PRODUCT_ERASURE_BATCH_SIZE,
    });
    return remaining ? CONTINUE : DONE;
  }
}
