import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type {
  MatchEvent,
  MatchEventHandler,
} from '../../../lib/core/match/match-events.ts';
import type { MatchDirectory } from '../../../lib/core/match/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type { WeekEntryRegistrar } from '../../../lib/core/week-tournament/ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'application', 'week-tournament']);

// イベントはマッチの識別子だけを運ぶため、勝者・Upvote数・最終Upvote時間・ローンチ日・勝利の確定時刻は照会で読む。
// 枠の作成はローンチの一意索引で既存の枠を無視するため、再試行・送り直しで同じイベントを何度処理してもよい。失敗は捕まえずに投げ、メッセージの再試行に任せる
@injectable()
export class QualifierEntryHandler implements MatchEventHandler {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly directory: MatchDirectory,
    @inject(WEEK_TOURNAMENT_TYPES.WeekEntryRegistrar)
    private readonly registrar: WeekEntryRegistrar,
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
        '確定したマッチが見つからないため参加の枠を作らずに終えました',
        {
          eventId: event.id,
          matchId: event.matchId,
          outcome: 'match-not-decided',
        },
      );
      return DONE;
    }
    await this.registrar.registerFromMatch(match, now);
    return DONE;
  }
}
