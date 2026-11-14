import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { EVENT_MATCH_TYPES } from './event-match-types.ts';
import type { MatchPurgeStore } from './ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

// match_entriesのproduct_id・launch_idがproducts・product_launchesを外部キーで参照するため、プロダクトの物理削除より前に紐付けだけを外し、マッチ記録と確定値と相手の側は残す。
// 紐付けの残る側だけを書き換えるため、再試行・送り直しで同じイベントを何度処理しても結果が変わらない
@injectable()
export class EntryUnlinkHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(EVENT_MATCH_TYPES.MatchPurgeStore)
    private readonly store: MatchPurgeStore,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    await this.store.unlinkProduct(event.productId, this.clock.now());
    return DONE;
  }
}
