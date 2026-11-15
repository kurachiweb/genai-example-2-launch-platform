import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { DIRECTORY_PLATFORM_TYPES } from '../../../lib/core/directory/identifiers.ts';
import type { DirectoryEntryStore } from '../../../lib/core/directory/ports.ts';
import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import type { SearchIndexRefreshRequester } from '../../../lib/core/search/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { EVENT_DIRECTORY_TYPES } from './event-directory-types.ts';
import {
  MAX_PRODUCTS_PER_PENDING_MARK,
  PRODUCT_SEARCH_TARGET_NAME,
  type ProductIndexPendingMarker,
} from './ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

// 1人の投稿者の勝利の記録は多くても数百件のため、continueで分けずに1回の実行で全てを読み、更新待ちの書き込みの単位の上限ずつ処理する。
// 掲載中かどうかは索引の更新の処理が処理の時点のプロダクトを読んで判定し、更新待ちの印と更新の要求は何度行っても結果が同じため、途中で失敗して最初から再試行されてもよい
@injectable()
export class AccountIndexRestoreHandler implements UserLifecycleAsyncHandler {
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

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const now = this.clock.now();
    let after: string | undefined;
    for (;;) {
      const productIds = await this.entries.listProductIdsByOwner(
        event.userId,
        after,
        MAX_PRODUCTS_PER_PENDING_MARK,
      );
      if (productIds.length === 0) {
        return DONE;
      }
      await this.pendingMarker.mark(productIds, now);
      for (const productId of productIds) {
        await this.requester.requestRefresh(
          PRODUCT_SEARCH_TARGET_NAME,
          productId,
        );
      }
      if (productIds.length < MAX_PRODUCTS_PER_PENDING_MARK) {
        return DONE;
      }
      after = productIds.at(-1);
    }
  }
}
