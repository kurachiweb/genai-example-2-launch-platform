import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { EveningDispatchGate } from '../../../lib/core/notifications/evening-dispatch.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../lib/core/scheduling/cron-registry.ts';
import type { BusinessTimeOfDay } from '../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../../lib/core/year-tournament/identifiers.ts';
import type {
  YearCalendar,
  YearDrawService,
  YearEntryFollowUp,
  YearEntryRegistrar,
  YearEntryStore,
  YearNotificationPublisher,
  YearProgressionService,
} from '../../../lib/core/year-tournament/ports.ts';
import type {
  YearEveningBracketStep,
  YearTournamentIncidentReporter,
} from './ports.ts';
import { YEAR_TOURNAMENT_API_TYPES } from './year-tournament-api-types.ts';

const YEAR_TOURNAMENT_JOB_ORDER = 1700;

const EVENING_BRACKET_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 23,
  minute: 45,
});

const MAINTENANCE_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 4,
  minute: 21,
});

export const YEAR_EVENING_BRACKET_PARTICIPANT =
  'tournament-year.evening-bracket';

// 同じ23:45の起動でマッチの確定(order 1100)・通知の夜の枠の準備(order 1300)・Weekトーナメントの夜の処理(order 1500)の後に動く
export const YEAR_EVENING_BRACKET_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: YEAR_EVENING_BRACKET_PARTICIPANT,
    at: EVENING_BRACKET_TIME,
    order: YEAR_TOURNAMENT_JOB_ORDER,
    handler: YEAR_TOURNAMENT_API_TYPES.EveningBracketJob,
  });

export const YEAR_ENTRY_FOLLOW_UP_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'tournament-year.entry-follow-up',
    at: MAINTENANCE_TIME,
    order: YEAR_TOURNAMENT_JOB_ORDER,
    handler: YEAR_TOURNAMENT_API_TYPES.EntryFollowUpJob,
  });

const MILLISECONDS_PER_MINUTE = 60_000;

// 依頼の直後に処理中の枠を二重に依頼しないよう、最後の更新から一定の時間が過ぎた枠だけを再処理する
export const YEAR_ENTRY_FOLLOW_UP_STALE_AFTER_MS = 10 * MILLISECONDS_PER_MINUTE;

export const YEAR_ENTRY_FOLLOW_UP_LIMIT = 100;

const logger = getAppLogger(['api', 'application', 'year-tournament']);

// 1つの段の失敗で他の段を止めないよう、失敗を集めて全ての段の後にまとめて扱う
class EveningFailures {
  readonly steps: YearEveningBracketStep[] = [];
  readonly errors: unknown[] = [];
  readonly years = new Set<number>();

  recordYears(years: readonly number[]): void {
    for (const year of years) {
      this.years.add(year);
    }
  }

  async attempt<T>(
    step: YearEveningBracketStep,
    run: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await run();
    } catch (error) {
      if (!this.steps.includes(step)) {
        this.steps.push(step);
      }
      this.errors.push(error);
      return undefined;
    }
  }

  get failed(): boolean {
    return this.errors.length > 0 || this.years.size > 0;
  }

  toError(): unknown {
    const years = this.years.size;
    if (this.errors.length === 0) {
      return new Error(
        `Yearトーナメントの組み合わせ決定・進行に失敗した年があります: ${String(years)}件`,
      );
    }
    if (this.errors.length === 1 && years === 0) {
      return this.errors[0];
    }
    return new AggregateError(
      this.errors,
      `Yearトーナメントの夜の処理に失敗しました: 例外${String(this.errors.length)}件・失敗した年${String(years)}件`,
    );
  }
}

@injectable()
export class YearEveningBracketJob implements ScheduledJobHandler {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearCalendar)
    private readonly calendar: YearCalendar,
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryRegistrar)
    private readonly registrar: YearEntryRegistrar,
    @inject(YEAR_TOURNAMENT_TYPES.YearDrawService)
    private readonly draws: YearDrawService,
    @inject(YEAR_TOURNAMENT_TYPES.YearProgressionService)
    private readonly progression: YearProgressionService,
    @inject(YEAR_TOURNAMENT_TYPES.YearNotificationPublisher)
    private readonly notifications: YearNotificationPublisher,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate)
    private readonly gate: EveningDispatchGate,
    @inject(YEAR_TOURNAMENT_API_TYPES.YearTournamentIncidentReporter)
    private readonly reporter: YearTournamentIncidentReporter,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  // 夜の送り出しは準備の完了を待つため、その夜の結果・予告・受賞の通知イベントを全て発行し終えてから最後に1回だけ伝える。
  // 失敗した夜は伝えずに、送り出しを通知の機能の期限に任せる
  async run({ business }: ScheduledJobContext): Promise<void> {
    const date = business.date;
    const now = this.clock.now();
    const failures = new EveningFailures();

    await failures.attempt('calendar', () => this.calendar.ensureUpcoming(now));

    const sync = await failures.attempt('entry-sync', async () => {
      const awardedFrom = await this.calendar.openPeriodStart(now);
      return this.registrar.syncChampions({ awardedFrom, now });
    });

    const draw = await failures.attempt('draw', () => this.draws.drawDue(now));
    failures.recordYears(draw?.failed ?? []);

    // 確定のマッチイベントの処理が終わっていなくても、マッチの結果から同じ夜のうちに追いつく
    const progress = await failures.attempt('progression', () =>
      this.progression.advanceAll(now),
    );
    failures.recordYears(progress?.failed ?? []);

    // 受賞の範囲をその日の0:00からatまでで読むため、組み合わせ決定と進行で記録した受賞を含むよう、ここで時計を読み直す
    await failures.attempt('evening-notification', () =>
      this.notifications.publishEvening({ date, at: this.clock.now() }),
    );

    if (failures.failed) {
      this.reporter.report({
        kind: 'evening-bracket-failed',
        date,
        failedSteps: [...failures.steps],
        failedYears: [...failures.years],
      });
      throw failures.toError();
    }

    const readiness = await this.gate.markReady({
      participant: YEAR_EVENING_BRACKET_PARTICIPANT,
      date,
      at: this.clock.now(),
    });
    logger.info(
      'Yearトーナメントの夜の処理を終え、送り出しの準備の完了を伝えました',
      {
        date,
        created: sync?.created.length ?? 0,
        late: sync?.late.length ?? 0,
        drawn: draw?.drawn ?? [],
        advanced: progress?.advanced ?? 0,
        readiness: readiness.kind,
        missingParticipants:
          readiness.kind === 'waiting' ? readiness.missing : [],
      },
    );
  }
}

@injectable()
export class YearEntryFollowUpJob implements ScheduledJobHandler {
  constructor(
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryStore)
    private readonly entries: YearEntryStore,
    @inject(YEAR_TOURNAMENT_TYPES.YearEntryFollowUp)
    private readonly followUp: YearEntryFollowUp,
    @inject(YEAR_TOURNAMENT_API_TYPES.YearTournamentIncidentReporter)
    private readonly reporter: YearTournamentIncidentReporter,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  // 依頼か知らせに失敗した枠は待ちのまま残るため、翌日の起動が再び拾う
  async run(): Promise<void> {
    const now = this.clock.now();
    let years: readonly number[] = [];
    let entryCount = 0;
    try {
      // ストアは「より前」で比べるため、ちょうど10分前に更新した枠も含めるよう1ミリ秒後を渡す
      const pending = await this.entries.listPendingFollowUps(
        new Date(now.getTime() - YEAR_ENTRY_FOLLOW_UP_STALE_AFTER_MS + 1),
        YEAR_ENTRY_FOLLOW_UP_LIMIT,
      );
      years = [
        ...new Set(
          pending.flatMap(({ classifiedYear }) =>
            classifiedYear === null ? [] : [classifiedYear],
          ),
        ),
      ].toSorted((left, right) => left - right);
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
        years,
        entryCount,
      });
      throw error;
    }
    logger.info('Yearトーナメントの返金と知らせを再処理しました', {
      entries: entryCount,
    });
  }
}
