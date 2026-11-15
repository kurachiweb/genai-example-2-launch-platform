import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { DIRECTORY_PLATFORM_TYPES } from '../../../lib/core/directory/identifiers.ts';
import type { DirectoryEntryStore } from '../../../lib/core/directory/ports.ts';
import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../../lib/core/product/product-lifecycle.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import type { SearchIndexRefreshRequester } from '../../../lib/core/search/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { EVENT_DIRECTORY_TYPES } from './event-directory-types.ts';
import {
  PRODUCT_SEARCH_TARGET_NAME,
  type ProductIndexPendingMarker,
} from './ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

// 掲載中かどうかは索引の更新の処理が処理の時点のプロダクトを読んで判定するため、勝利の記録があれば復元の後の状態を問わず作り直しを要求する。
// 更新待ちの印と更新の要求は何度行っても結果が同じため、再試行・送り直しで同じイベントを何度処理してもよい
@injectable()
export class ProductIndexRestoreHandler implements ProductLifecycleAsyncHandler {
  constructor(
    @inject(DIRECTORY_PLATFORM_TYPES.DirectoryEntryStore)
    private readonly entries: DirectoryEntryStore,
    @inject(EVENT_DIRECTORY_TYPES.ProductIndexPendingMarker)
    private readonly pendingMarker: ProductIndexPendingMarker,
    @inject(SEARCH_TYPES.RefreshRequester)
    private readonly requester: SearchIndexRefreshRequester,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(event: ProductLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    if (!(await this.entries.exists(event.productId))) {
      return DONE;
    }
    await this.pendingMarker.mark([event.productId], this.clock.now());
    await this.requester.requestRefresh(
      PRODUCT_SEARCH_TARGET_NAME,
      event.productId,
    );
    return DONE;
  }
}
