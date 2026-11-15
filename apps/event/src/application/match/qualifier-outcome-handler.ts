import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
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
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  LaunchOutcomeRecorder,
  OutcomeEntry,
} from '../../../lib/core/product/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'match', 'events']);

// 物理削除で紐付けを解除した側は記録の対象のローンチが無いため除く
function outcomeEntriesOf(
  match: MatchRecord,
  decidedAt: Date,
): readonly OutcomeEntry[] {
  return match.entries.flatMap(({ launchId, result }) =>
    launchId === null || result === null
      ? []
      : [
          {
            launchId,
            outcome: isWinningResult(result) ? 'won' : 'lost',
            decidedAt,
          },
        ],
  );
}

// マッチと側を呼び出しのたびにD1から求め直し、記録の口は確定した結果を書き換えないため、再試行・送り直しで同じイベントを何度処理しても結果が変わらない。記録の失敗は捕まえずに投げ、メッセージの再試行に任せる
@injectable()
export class QualifierOutcomeHandler implements MatchEventHandler {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly directory: MatchDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.LaunchOutcomeRecorder)
    private readonly recorder: LaunchOutcomeRecorder,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(event: MatchEvent): Promise<LifecycleHandlerOutcome> {
    if (event.type !== 'decided' || event.kind !== 'qualifier') {
      return DONE;
    }
    const match = (
      await this.directory.findMatches([event.matchId], this.clock.now())
    ).get(event.matchId);
    if (match?.decidedAt == null) {
      logger.warn(
        '確定したマッチが見つからないため予選の結果を記録せずに終えました',
        {
          eventId: event.id,
          matchId: event.matchId,
          outcome: 'match-not-decided',
        },
      );
      return DONE;
    }
    const entries = outcomeEntriesOf(match, match.decidedAt);
    if (entries.length === 0) {
      return DONE;
    }
    const results = await this.recorder.record(entries);
    for (const entry of entries) {
      const result = results.get(entry.launchId);
      // 異なる結果が既にあるのは運営者の手作業の記録などとの食い違いで、再試行しても解消しないため警告に留めて完了する
      if (result === 'conflict') {
        logger.warn(
          'ローンチに異なる予選の結果が記録済みのため書き換えませんでした',
          {
            eventId: event.id,
            matchId: event.matchId,
            launchId: entry.launchId,
            qualifierOutcome: entry.outcome,
            outcome: result,
          },
        );
      }
    }
    return DONE;
  }
}
