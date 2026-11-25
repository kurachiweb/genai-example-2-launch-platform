import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import type { MatchDirectory } from '../../../lib/core/match/ports.ts';
import type { EveningDispatchGate } from '../../../lib/core/notifications/evening-dispatch.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../lib/core/scheduling/cron-registry.ts';
import type {
  BusinessDate,
  BusinessTimeOfDay,
} from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../../lib/core/week-tournament/identifiers.ts';
import type {
  WeekDrawService,
  WeekEntryFollowUp,
  WeekEntryRegistrar,
  WeekNotificationPublisher,
  WeekProgressionService,
  WeekTournamentStore,
} from '../../../lib/core/week-tournament/ports.ts';
import type {
  WeekEveningBracketStep,
  WeekTournamentIncidentReporter,
} from './ports.ts';
import { WEEK_TOURNAMENT_API_TYPES } from './week-tournament-api-types.ts';

const WEEK_TOURNAMENT_JOB_ORDER = 1500;

const EVENING_BRACKET_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 23,
  minute: 45,
});

const MAINTENANCE_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 4,
  minute: 21,
});

export const EVENING_BRACKET_PARTICIPANT = 'tournament-week.evening-bracket';

// 同じ23:45の起動でマッチのペアリング(order 1100)と通知の夜の枠の準備(order 1300)の後に動く
export const EVENING_BRACKET_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: EVENING_BRACKET_PARTICIPANT,
    at: EVENING_BRACKET_TIME,
    order: WEEK_TOURNAMENT_JOB_ORDER,
    handler: WEEK_TOURNAMENT_API_TYPES.EveningBracketJob,
  });

export const ENTRY_FOLLOW_UP_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'tournament-week.entry-follow-up',
    at: MAINTENANCE_TIME,
    order: WEEK_TOURNAMENT_JOB_ORDER,
    handler: WEEK_TOURNAMENT_API_TYPES.EntryFollowUpJob,
  });

const MILLISECONDS_PER_MINUTE = 60_000;

// 依頼の直後に処理中の枠を二重に依頼しないよう、最後の更新から一定の時間が過ぎた枠だけを再処理する
export const ENTRY_FOLLOW_UP_STALE_AFTER_MS = 10 * MILLISECONDS_PER_MINUTE;

export const ENTRY_FOLLOW_UP_LIMIT = 100;

const logger = getAppLogger(['api', 'application', 'week-tournament']);

// 1つの手順の失敗で他の手順を止めないよう、失敗を集めて全ての手順の後にまとめて扱う
class EveningFailures {
  readonly steps: WeekEveningBracketStep[] = [];
  readonly errors: unknown[] = [];
  readonly tournamentIds = new Set<string>();

  record(step: WeekEveningBracketStep, errors: readonly unknown[]): void {
    if (errors.length === 0) {
      return;
    }
    if (!this.steps.includes(step)) {
      this.steps.push(step);
    }
    this.errors.push(...errors);
  }

  recordTournaments(tournamentIds: readonly string[]): void {
    for (const tournamentId of tournamentIds) {
      this.tournamentIds.add(tournamentId);
    }
  }

  async attempt<T>(
    step: WeekEveningBracketStep,
    run: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await run();
    } catch (error) {
      this.record(step, [error]);
      return undefined;
    }
  }

  get failed(): boolean {
    return this.errors.length > 0 || this.tournamentIds.size > 0;
  }

  toError(): unknown {
    const tournaments = this.tournamentIds.size;
    if (this.errors.length === 0) {
      return new Error(
        `Weekトーナメントの組み合わせ決定・進行に失敗したトーナメントがあります: ${String(tournaments)}件`,
      );
    }
    if (this.errors.length === 1 && tournaments === 0) {
      return this.errors[0];
    }
    return new AggregateError(
      this.errors,
      `Weekトーナメントの夜の処理に失敗しました: 例外${String(this.errors.length)}件・失敗したトーナメント${String(tournaments)}件`,
    );
  }
}

interface CatchUpResult {
  readonly matches: number;
  readonly errors: readonly unknown[];
}

@injectable()
export class EveningBracketJob implements ScheduledJobHandler {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekDrawService)
    private readonly draws: WeekDrawService,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(WEEK_TOURNAMENT_TYPES.WeekEntryRegistrar)
    private readonly registrar: WeekEntryRegistrar,
    @inject(WEEK_TOURNAMENT_TYPES.WeekProgressionService)
    private readonly progression: WeekProgressionService,
    @inject(WEEK_TOURNAMENT_TYPES.WeekNotificationPublisher)
    private readonly notifications: WeekNotificationPublisher,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate)
    private readonly gate: EveningDispatchGate,
    @inject(WEEK_TOURNAMENT_API_TYPES.WeekTournamentIncidentReporter)
    private readonly reporter: WeekTournamentIncidentReporter,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  // 夜の送り出しは準備の完了を待つため、その夜の結果・予告・受賞の通知イベントを全て発行し終えてから最後に1回だけ伝える。
  // 失敗した夜は伝えずに、送り出しを通知の機能の期限に任せる
  async run({ business }: ScheduledJobContext): Promise<void> {
    const date = business.date;
    const now = this.clock.now();
    const failures = new EveningFailures();

    const draw = await failures.attempt('draw', () => this.draws.drawDue(now));
    failures.recordTournaments(draw?.failed ?? []);

    // 確定のマッチイベントの処理が遅れた勝者の枠を、組み合わせ決定と同じ夜のうちに作る
    const catchUp = await failures.attempt('entry-catch-up', () =>
      this.catchUpEntries(date, now),
    );
    failures.record('entry-catch-up', catchUp?.errors ?? []);

    const progress = await failures.attempt('progression', () =>
      this.progression.advanceAll(now),
    );
    failures.recordTournaments(progress?.failed ?? []);

    // 受賞の範囲を[0:00, at)で読むため、組み合わせ決定と進行で記録した受賞を含むよう、ここで時計を読み直す
    await failures.attempt('night-notification', () =>
      this.notifications.publishNight({ date, at: this.clock.now() }),
    );

    if (failures.failed) {
      this.reporter.report({
        kind: 'evening-bracket-failed',
        date,
        failedSteps: [...failures.steps],
        failedTournamentIds: [...failures.tournamentIds],
      });
      throw failures.toError();
    }

    const readiness = await this.gate.markReady({
      participant: EVENING_BRACKET_PARTICIPANT,
      date,
      at: this.clock.now(),
    });
    logger.info(
      'Weekトーナメントの夜の処理を終え、送り出しの準備の完了を伝えました',
      {
        date,
        drawn: draw?.drawn.length ?? 0,
        catchUpMatches: catchUp?.matches ?? 0,
        advanced: progress?.advanced ?? 0,
        readiness: readiness.kind,
        missingParticipants:
          readiness.kind === 'waiting' ? readiness.missing : [],
      },
    );
  }

  private async catchUpEntries(
    date: BusinessDate,
    now: Date,
  ): Promise<CatchUpResult> {
    const records = await this.matches.listForDate({
      date,
      kinds: ['qualifier'],
      now,
    });
    const decided = records.filter(({ decidedAt }) => decidedAt !== null);
    const errors: unknown[] = [];
    for (const match of decided) {
      try {
        await this.registrar.registerFromMatch(match, now);
      } catch (error) {
        errors.push(error);
      }
    }
    return { matches: decided.length, errors };
  }
}

@injectable()
export class EntryFollowUpJob implements ScheduledJobHandler {
  constructor(
    @inject(WEEK_TOURNAMENT_TYPES.WeekTournamentStore)
    private readonly store: WeekTournamentStore,
    @inject(WEEK_TOURNAMENT_TYPES.WeekEntryFollowUp)
    private readonly followUp: WeekEntryFollowUp,
    @inject(WEEK_TOURNAMENT_API_TYPES.WeekTournamentIncidentReporter)
    private readonly reporter: WeekTournamentIncidentReporter,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  // 依頼か知らせに失敗した枠は待ちのまま残るため、翌日の起動が再び拾う
  async run(): Promise<void> {
    const now = this.clock.now();
    let tournamentIds: readonly string[] = [];
    let entryCount = 0;
    try {
      // ストアは「より前」で比べるため、ちょうど10分前に更新した枠も含めるよう1ミリ秒後を渡す
      const pending = await this.store.listPendingFollowUps(
        new Date(now.getTime() - ENTRY_FOLLOW_UP_STALE_AFTER_MS + 1),
        ENTRY_FOLLOW_UP_LIMIT,
      );
      tournamentIds = [...new Set(pending.map((entry) => entry.tournamentId))];
      entryCount = pending.length;
      if (pending.length > 0) {
        await this.followUp.process(
          pending.map(({ entryId }) => entryId),
          now,
        );
      }
    } catch (error) {
      this.reporter.report({
        kind: 'entry-follow-up-failed',
        tournamentIds,
        entryCount,
      });
      throw error;
    }
    logger.info('Weekトーナメントの返金と知らせを再処理しました', {
      entries: entryCount,
    });
  }
}
