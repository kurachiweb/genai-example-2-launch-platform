import type { Logger } from '@logtape/logtape';
import { captureException } from '@sentry/cloudflare';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import type {
  AdvanceResult,
  BracketProgression,
} from '../../core/tournament/ports.ts';
import { dailyRoundPolicy } from '../../core/tournament/round-schedule.ts';
import type {
  WeekNotificationPublisher,
  WeekProgressionService,
  WeekTournamentRecord,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import { weekFirstRoundDate } from '../../core/week-tournament/week-schedule.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { safeTagOf } from './incident-tags.ts';

// 23:45のジョブの1回の実行で進める進行中のトーナメントの上限
const ADVANCE_ALL_LIMIT = 50;

const ADVANCE_FAILED_MESSAGE = 'Weekトーナメントの進行に失敗しました';

const UNLINKED_CHAMPION_MESSAGE =
  '紐付けを解除した優勝の枠のため、受賞の通知イベントを発行しません';

export class WeekTournamentProgressionService implements WeekProgressionService {
  private readonly logger: Logger;

  constructor(
    private readonly store: WeekTournamentStore,
    private readonly progression: BracketProgression,
    private readonly notifications: WeekNotificationPublisher,
    appName: LoggingOptions['appName'],
  ) {
    this.logger = getAppLogger([appName, 'week-tournament', 'progression']);
  }

  async advance(
    tournamentId: string,
    now: Date,
  ): Promise<AdvanceResult | undefined> {
    const tournament = await this.store.findTournament(tournamentId);
    return tournament === undefined
      ? undefined
      : this.advanceTournament(tournament, now);
  }

  async advanceAll(now: Date): Promise<{
    readonly advanced: number;
    readonly failed: readonly string[];
  }> {
    const tournaments = await this.store.listInProgress(ADVANCE_ALL_LIMIT);
    let advanced = 0;
    const failed: string[] = [];
    for (const tournament of tournaments) {
      try {
        const result = await this.advanceTournament(tournament, now);
        if (result !== undefined) {
          await this.applyResult(tournament, result, now);
          advanced += 1;
        }
      } catch (error) {
        failed.push(tournament.tournamentId);
        this.reportFailure(tournament.tournamentId, error);
      }
    }
    return { advanced, failed };
  }

  // 発行は冪等で、受賞の重複は週と受賞したプロダクトで除かれるため、終了の記録より先に発行する。
  // 発行に失敗しても週が進行中のまま残り、イベントの再試行や23:45の実行が発行と記録をやり直せる
  async applyResult(
    tournament: WeekTournamentRecord,
    result: AdvanceResult,
    now: Date,
  ): Promise<void> {
    await this.notifications.publishRound({
      decidedMatchIds: result.decidedMatchIds,
      previewMatchIds: result.kind === 'finished' ? [] : result.previewMatchIds,
      at: now,
    });
    if (result.kind !== 'finished') {
      return;
    }
    if (result.championRef !== null) {
      await this.publishAward(tournament, result.championRef, now);
    }
    await this.store.recordFinish(
      tournament.tournamentId,
      result.championRef === null ? 'no_award' : 'awarded',
      result.championRef,
      now,
    );
  }

  private advanceTournament(
    tournament: WeekTournamentRecord,
    now: Date,
  ): Promise<AdvanceResult> | undefined {
    if (tournament.status !== 'in_progress' || tournament.bracketId === null) {
      return undefined;
    }
    // 方針は現在の業務日付から遅れの下限を決めるため、呼び出しのたびに作り直す
    return this.progression.advance(
      tournament.bracketId,
      dailyRoundPolicy(weekFirstRoundDate(tournament.window.weekStart), now),
      now,
    );
  }

  private async publishAward(
    tournament: WeekTournamentRecord,
    championEntryId: string,
    now: Date,
  ): Promise<void> {
    const champion = await this.store.findEntry(championEntryId);
    if (champion?.productId == null) {
      this.logger.info(UNLINKED_CHAMPION_MESSAGE, {
        tournamentId: tournament.tournamentId,
        entryId: championEntryId,
      });
      return;
    }
    await this.notifications.publishAward({
      weekStart: tournament.window.weekStart,
      productId: champion.productId,
      at: now,
    });
  }

  private reportFailure(tournamentId: string, error: unknown): void {
    this.logger.error(ADVANCE_FAILED_MESSAGE, { tournamentId, error });
    captureException(error, {
      tags: { tournament_id: safeTagOf(tournamentId) },
    });
  }
}
