import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { DIRECTORY_PLATFORM_TYPES } from '../../../lib/core/directory/identifiers.ts';
import type {
  DirectoryEntry,
  DirectoryEntryStore,
} from '../../../lib/core/directory/ports.ts';
import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchEvent,
  MatchEventHandler,
} from '../../../lib/core/match/match-events.ts';
import { isWinningResult } from '../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import type { SearchIndexRefreshRequester } from '../../../lib/core/search/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { EVENT_DIRECTORY_TYPES } from './event-directory-types.ts';
import {
  PRODUCT_SEARCH_TARGET_NAME,
  type ProductIndexPendingMarker,
} from './ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'application', 'directory']);

// 物理削除や投稿者の削除で紐付けを解除した側は、掲載するプロダクトや投稿者が無いため除く
function winnersOf(match: MatchRecord): readonly DirectoryEntry[] {
  return match.entries.flatMap(({ productId, ownerUserId, result }) =>
    productId === null ||
    ownerUserId === null ||
    result === null ||
    !isWinningResult(result)
      ? []
      : [{ productId, ownerUserId }],
  );
}

// 掲載中かどうかは索引の更新の処理が処理の時点のプロダクトを読んで判定する。記録は既存の行を無視し、更新待ちの印と更新の要求は何度行っても結果が同じため、再試行・送り直しで同じイベントを何度処理してもよい。書き込みの失敗は捕まえずに投げ、メッセージの再試行に任せる
@injectable()
export class QualifierListingHandler implements MatchEventHandler {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly directory: MatchDirectory,
    @inject(DIRECTORY_PLATFORM_TYPES.DirectoryEntryStore)
    private readonly entries: DirectoryEntryStore,
    @inject(EVENT_DIRECTORY_TYPES.ProductIndexPendingMarker)
    private readonly pendingMarker: ProductIndexPendingMarker,
    @inject(SEARCH_TYPES.RefreshRequester)
    private readonly requester: SearchIndexRefreshRequester,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(event: MatchEvent): Promise<LifecycleHandlerOutcome> {
    if (event.type !== 'decided' || event.kind !== 'qualifier') {
      return DONE;
    }
    const now = this.clock.now();
    const match = (await this.directory.findMatches([event.matchId], now)).get(
      event.matchId,
    );
    if (match?.decidedAt == null) {
      logger.warn(
        '確定したマッチが見つからないため掲載の記録をせずに終えました',
        {
          eventId: event.id,
          matchId: event.matchId,
          outcome: 'match-not-decided',
        },
      );
      return DONE;
    }
    const winners = winnersOf(match);
    if (winners.length === 0) {
      return DONE;
    }
    await this.entries.record(winners, match.decidedAt);
    const productIds = winners.map(({ productId }) => productId);
    await this.pendingMarker.mark(productIds, now);
    for (const productId of productIds) {
      await this.requester.requestRefresh(
        PRODUCT_SEARCH_TARGET_NAME,
        productId,
      );
    }
    return DONE;
  }
}
