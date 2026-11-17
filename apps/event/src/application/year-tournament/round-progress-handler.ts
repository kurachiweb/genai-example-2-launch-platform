import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { LifecycleHandlerOutcome } from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  MatchEvent,
  MatchEventHandler,
} from '../../../lib/core/match/match-events.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../../lib/core/tournament/ports.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearProgressionService,
  YearTournamentStore,
} from '../../../lib/core/year-tournament/ports.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'application', 'year-tournament']);

// 23:45のジョブも同じ進行を呼び、次ラウンドの位置とマッチIDは先に挿入した側にそろう。通知の発行は重複を除かれ、終了の記録は1回だけ確定するため、
// 再試行・送り直しで同じイベントを何度処理してもよい。失敗は捕まえずに投げ、メッセージの再試行に任せる
@injectable()
export class RoundProgressHandler implements MatchEventHandler {
  constructor(
    @inject(TOURNAMENT_PLATFORM_TYPES.BracketStore)
    private readonly brackets: BracketStore,
    @inject(YEAR_TOURNAMENT_TYPES.YearTournamentStore)
    private readonly store: YearTournamentStore,
    @inject(YEAR_TOURNAMENT_TYPES.YearProgressionService)
    private readonly progression: YearProgressionService,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(event: MatchEvent): Promise<LifecycleHandlerOutcome> {
    if (event.type !== 'decided' || event.kind !== 'year') {
      return DONE;
    }
    const bracket = (await this.brackets.findByMatchIds([event.matchId])).get(
      event.matchId,
    );
    if (bracket?.kind !== 'year') {
      return DONE;
    }
    const tournament = await this.store.findById(bracket.tournamentId);
    if (tournament === undefined) {
      logger.warn(
        'ブラケットのYearトーナメントの年が見つからないためラウンドを進めずに終えました',
        {
          eventId: event.id,
          matchId: event.matchId,
          bracketId: bracket.bracketId,
          yearTournamentId: bracket.tournamentId,
          outcome: 'tournament-not-found',
        },
      );
      return DONE;
    }
    const now = this.clock.now();
    const result = await this.progression.advance(
      tournament.yearTournamentId,
      now,
    );
    if (result !== undefined) {
      await this.progression.applyResult(tournament, result, now);
    }
    return DONE;
  }
}
