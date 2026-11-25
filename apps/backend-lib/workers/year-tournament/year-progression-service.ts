import type { Logger } from '@logtape/logtape';
import { captureException } from '@sentry/cloudflare';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { BusinessDate } from '../../core/time/business-time.ts';
import type {
  AdvanceResult,
  BracketProgression,
} from '../../core/tournament/ports.ts';
import { dailyRoundPolicy } from '../../core/tournament/round-schedule.ts';
import type {
  YearEntryStore,
  YearNotificationPublisher,
  YearProgressionService,
  YearTournamentRecord,
  YearTournamentStore,
} from '../../core/year-tournament/ports.ts';
import { yearFirstRoundDate } from '../../core/year-tournament/year-schedule.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import { safeTagOf } from './incident-tags.ts';

// 23:45のジョブの1回の実行で進める進行中の年の上限
const ADVANCE_ALL_LIMIT = 50;

const ADVANCE_FAILED_MESSAGE = 'Yearトーナメントの進行に失敗しました';

const UNLINKED_CHAMPION_MESSAGE =
  '紐付けを解除した優勝の枠のため、受賞の通知イベントを発行しません';

// ラウンドの日は決勝日から逆算するため、組み合わせ決定と同じく決勝日と参加数から1回戦の予定の日を求める
function plannedFirstRoundDateOf(
  tournament: YearTournamentRecord,
  participantCount: number,
): BusinessDate {
  const { finalDate } = tournament.schedule;
  return yearFirstRoundDate(finalDate, participantCount) ?? finalDate;
}

export class YearTournamentProgressionService implements YearProgressionService {
  private readonly logger: Logger;

  constructor(
    private readonly tournaments: YearTournamentStore,
    private readonly entries: YearEntryStore,
    private readonly progression: BracketProgression,
    private readonly notifications: YearNotificationPublisher,
    appName: LoggingOptions['appName'],
  ) {
    this.logger = getAppLogger([appName, 'year-tournament', 'progression']);
  }

  async advance(
    yearTournamentId: string,
    now: Date,
  ): Promise<AdvanceResult | undefined> {
    const tournament = await this.tournaments.findById(yearTournamentId);
    return tournament === undefined
      ? undefined
      : this.advanceTournament(tournament, now);
  }

  async advanceAll(now: Date): Promise<{
    readonly advanced: number;
    readonly failed: readonly number[];
  }> {
    const tournaments =
      await this.tournaments.listInProgress(ADVANCE_ALL_LIMIT);
    let advanced = 0;
    const failed: number[] = [];
    for (const tournament of tournaments) {
      try {
        const result = await this.advanceTournament(tournament, now);
        if (result !== undefined) {
          await this.applyResult(tournament, result, now);
          advanced += 1;
        }
      } catch (error) {
        failed.push(tournament.year);
        this.reportFailure(tournament, error);
      }
    }
    return { advanced, failed };
  }

  // 発行は冪等で、受賞の重複は対象年と受賞したプロダクトで除かれるため、終了の記録より先に発行する。
  // 発行に失敗しても年が進行中のまま残り、イベントの再試行や23:45の実行が発行と記録をやり直せる
  async applyResult(
    tournament: YearTournamentRecord,
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
    await this.tournaments.recordFinish(
      tournament.yearTournamentId,
      result.championRef === null ? 'no_award' : 'awarded',
      result.championRef,
      now,
    );
  }

  private advanceTournament(
    tournament: YearTournamentRecord,
    now: Date,
  ): Promise<AdvanceResult> | undefined {
    if (
      tournament.status !== 'in_progress' ||
      tournament.bracketId === null ||
      tournament.participantCount === null
    ) {
      return undefined;
    }
    // 方針は現在の業務日付から遅れの下限を決めるため、呼び出しのたびに作り直す
    return this.progression.advance(
      tournament.bracketId,
      dailyRoundPolicy(
        plannedFirstRoundDateOf(tournament, tournament.participantCount),
        now,
      ),
      now,
    );
  }

  private async publishAward(
    tournament: YearTournamentRecord,
    championEntryId: string,
    now: Date,
  ): Promise<void> {
    const champion = await this.entries.findEntry(championEntryId);
    if (champion?.productId == null) {
      this.logger.info(UNLINKED_CHAMPION_MESSAGE, {
        yearTournamentId: tournament.yearTournamentId,
        year: tournament.year,
        entryId: championEntryId,
      });
      return;
    }
    await this.notifications.publishAward({
      year: tournament.year,
      productId: champion.productId,
      at: now,
    });
  }

  private reportFailure(
    tournament: YearTournamentRecord,
    error: unknown,
  ): void {
    this.logger.error(ADVANCE_FAILED_MESSAGE, {
      yearTournamentId: tournament.yearTournamentId,
      year: tournament.year,
      error,
    });
    captureException(error, {
      tags: {
        year: String(tournament.year),
        year_tournament_id: safeTagOf(tournament.yearTournamentId),
      },
    });
  }
}
