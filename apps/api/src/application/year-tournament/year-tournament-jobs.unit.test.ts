import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import {
  EveningDispatchError,
  type EveningDispatchReadiness,
} from '../../../lib/core/notifications/evening-dispatch.ts';
import type { YearEntryRecord } from '../../../lib/core/year-tournament/ports.ts';
import type { YearEveningBracketStep } from './ports.ts';
import {
  type CallLog,
  CLOCK_STEP_MS,
  createFakeEveningDispatchGate,
  createFakeFollowUpEntryStore,
  createFakeYearCalendar,
  createFakeYearDrawService,
  createFakeYearEntryFollowUp,
  createFakeYearEntryRegistrar,
  createFakeYearNotificationPublisher,
  createFakeYearProgressionService,
  createLoggingIncidentReporter,
  createSteppingClock,
  entryIdOf,
  type Failure,
  JOB_DATE,
  jobContextOf,
  pendingEntryOf,
  scheduledAt,
} from './testing/year-tournament-job-fakes.ts';
import { YEAR_TOURNAMENT_API_TYPES } from './year-tournament-api-types.ts';
import {
  YEAR_ENTRY_FOLLOW_UP_JOB_DEFINITION,
  YEAR_ENTRY_FOLLOW_UP_LIMIT,
  YEAR_ENTRY_FOLLOW_UP_STALE_AFTER_MS,
  YEAR_EVENING_BRACKET_JOB_DEFINITION,
  YEAR_EVENING_BRACKET_PARTICIPANT,
  YearEntryFollowUpJob,
  YearEveningBracketJob,
} from './year-tournament-jobs.ts';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

function yearTournamentLogs() {
  return records
    .filter(
      (record) =>
        record.category.join('.') === 'api.application.year-tournament',
    )
    .map(({ level, properties }) => ({ level, properties }));
}

const EVENING_TIME = scheduledAt(JOB_DATE, { hour: 23, minute: 45 });
const EVENING_NOW = new Date(EVENING_TIME.getTime() + 2_000);
const OPEN_PERIOD_START = scheduledAt(JOB_DATE, { hour: 0, minute: 0 }, -1);
const FOLLOW_UP_TIME = scheduledAt(JOB_DATE, { hour: 4, minute: 21 });
const FOLLOW_UP_NOW = new Date(FOLLOW_UP_TIME.getTime() + 3_000);

function atStep(start: Date, step: number): Date {
  return new Date(start.getTime() + step * CLOCK_STEP_MS);
}

interface EveningJobOptions {
  readonly openPeriodStart?: Date | null;
  readonly ensureFailure?: Failure;
  readonly openPeriodFailure?: Failure;
  readonly created?: readonly string[];
  readonly late?: readonly string[];
  readonly skipped?: number;
  readonly syncFailure?: Failure;
  readonly drawn?: readonly number[];
  readonly drawFailed?: readonly number[];
  readonly drawFailure?: Failure;
  readonly advanced?: number;
  readonly advanceFailed?: readonly number[];
  readonly advanceFailure?: Failure;
  readonly publishFailure?: Failure;
  readonly readiness?: EveningDispatchReadiness;
  readonly markFailure?: Failure;
}

function eveningJobOf(options: EveningJobOptions = {}) {
  const log: CallLog = [];
  const clock = createSteppingClock(EVENING_NOW);
  const calendar = createFakeYearCalendar(log, {
    openPeriodStart: options.openPeriodStart ?? null,
    ensureFailure: options.ensureFailure,
    openPeriodFailure: options.openPeriodFailure,
  });
  const registrar = createFakeYearEntryRegistrar(
    log,
    {
      created: options.created ?? [],
      late: options.late ?? [],
      skipped: options.skipped ?? 0,
    },
    options.syncFailure,
  );
  const draws = createFakeYearDrawService(
    log,
    { drawn: options.drawn ?? [], failed: options.drawFailed ?? [] },
    options.drawFailure,
  );
  const progression = createFakeYearProgressionService(
    log,
    { advanced: options.advanced ?? 0, failed: options.advanceFailed ?? [] },
    options.advanceFailure,
  );
  const notifications = createFakeYearNotificationPublisher(
    log,
    options.publishFailure,
  );
  const gate = createFakeEveningDispatchGate(
    log,
    options.readiness,
    options.markFailure,
  );
  const reporter = createLoggingIncidentReporter(log);
  const job = new YearEveningBracketJob(
    calendar,
    registrar,
    draws,
    progression,
    notifications,
    gate,
    reporter,
    clock,
  );
  return {
    job,
    log,
    clock,
    calendar,
    registrar,
    draws,
    progression,
    notifications,
    gate,
    reporter,
  };
}

const ATTEMPTED_STEPS = [
  'ensureUpcoming',
  'openPeriodStart',
  'drawDue',
  'advanceAll',
  'publishEvening',
] as const;

describe('ジョブの定義', () => {
  test('23:45の夜の処理は1700でtournament-year.evening-bracketの名前とジョブの識別子を持つ', () => {
    expect(YEAR_EVENING_BRACKET_JOB_DEFINITION).toStrictEqual({
      name: 'tournament-year.evening-bracket',
      at: { hour: 23, minute: 45 },
      order: 1700,
      handler: YEAR_TOURNAMENT_API_TYPES.EveningBracketJob,
    });
    expect(Object.isFrozen(YEAR_EVENING_BRACKET_JOB_DEFINITION)).toBe(true);
  });

  test('夜の送り出しの前提の名前はジョブの名前と同じである', () => {
    expect(YEAR_EVENING_BRACKET_PARTICIPANT).toBe(
      YEAR_EVENING_BRACKET_JOB_DEFINITION.name,
    );
  });

  test('4:21の再処理は1700でtournament-year.entry-follow-upの名前とジョブの識別子を持つ', () => {
    expect(YEAR_ENTRY_FOLLOW_UP_JOB_DEFINITION).toStrictEqual({
      name: 'tournament-year.entry-follow-up',
      at: { hour: 4, minute: 21 },
      order: 1700,
      handler: YEAR_TOURNAMENT_API_TYPES.EntryFollowUpJob,
    });
    expect(Object.isFrozen(YEAR_ENTRY_FOLLOW_UP_JOB_DEFINITION)).toBe(true);
  });
});

describe('YearEveningBracketJob', () => {
  test('年の行の用意とWeek優勝の取り込み・組み合わせ決定・進行・その夜の一括の発行の順に行い、最後に準備の完了を1回伝える', async () => {
    const fixture = eveningJobOf({
      openPeriodStart: OPEN_PERIOD_START,
      created: [entryIdOf(1)],
      drawn: [2027],
      advanced: 3,
    });

    await fixture.job.run(jobContextOf(EVENING_TIME));

    expect(fixture.log).toStrictEqual([
      'ensureUpcoming',
      'openPeriodStart',
      'syncChampions',
      'drawDue',
      'advanceAll',
      'publishEvening',
      'markReady',
    ]);
    expect(fixture.calendar.ensureNows).toStrictEqual([EVENING_NOW]);
    expect(fixture.calendar.openPeriodNows).toStrictEqual([EVENING_NOW]);
    expect(fixture.registrar.inputs).toStrictEqual([
      { awardedFrom: OPEN_PERIOD_START, now: EVENING_NOW },
    ]);
    expect(fixture.draws.nows).toStrictEqual([EVENING_NOW]);
    expect(fixture.progression.nows).toStrictEqual([EVENING_NOW]);
    expect(fixture.reporter.incidents).toStrictEqual([]);
  });

  test('凍結済みの年が無ければ、Week優勝の取り込みに下限を渡さない', async () => {
    const fixture = eveningJobOf({ openPeriodStart: null });

    await fixture.job.run(jobContextOf(EVENING_TIME));

    expect(fixture.registrar.inputs).toStrictEqual([
      { awardedFrom: null, now: EVENING_NOW },
    ]);
  });

  test('一括の発行には進行の後に読み直した時刻を、準備の完了にはその直前に読んだ時刻とジョブの予定時刻の業務日付を渡す', async () => {
    const fixture = eveningJobOf();

    await fixture.job.run(jobContextOf(EVENING_TIME));

    expect(fixture.clock.reads).toStrictEqual([
      EVENING_NOW,
      atStep(EVENING_NOW, 1),
      atStep(EVENING_NOW, 2),
    ]);
    expect(fixture.notifications.evenings).toStrictEqual([
      { date: JOB_DATE, at: atStep(EVENING_NOW, 1) },
    ]);
    expect(fixture.gate.inputs).toStrictEqual([
      {
        participant: 'tournament-year.evening-bracket',
        date: JOB_DATE,
        at: atStep(EVENING_NOW, 2),
      },
    ]);
  });

  test('起動が遅れて日付をまたいでも、準備の完了と一括の発行にはジョブの予定時刻の業務日付を渡す', async () => {
    const lateNow = scheduledAt(JOB_DATE, { hour: 23, minute: 59 }, 59_000);
    const fixture = eveningJobOf();
    const job = new YearEveningBracketJob(
      fixture.calendar,
      fixture.registrar,
      fixture.draws,
      fixture.progression,
      fixture.notifications,
      fixture.gate,
      fixture.reporter,
      createSteppingClock(lateNow),
    );

    await job.run(jobContextOf(EVENING_TIME));

    expect(
      fixture.notifications.evenings.map(({ date }) => date),
    ).toStrictEqual([JOB_DATE]);
    expect(fixture.gate.inputs.map(({ date }) => date)).toStrictEqual([
      JOB_DATE,
    ]);
  });

  test('組み合わせも進行も無い夜も、一括の発行をして最後に準備の完了を1回伝える', async () => {
    const fixture = eveningJobOf();

    await fixture.job.run(jobContextOf(EVENING_TIME));

    expect(fixture.log).toStrictEqual([
      'ensureUpcoming',
      'openPeriodStart',
      'syncChampions',
      'drawDue',
      'advanceAll',
      'publishEvening',
      'markReady',
    ]);
    expect(fixture.log.filter((call) => call === 'markReady')).toHaveLength(1);
  });

  test('遅れて作った枠と予選が見つからず作らなかった件数は失敗にしない', async () => {
    const fixture = eveningJobOf({ late: [entryIdOf(2)], skipped: 1 });

    await fixture.job.run(jobContextOf(EVENING_TIME));

    expect(fixture.log.at(-1)).toBe('markReady');
    expect(fixture.reporter.incidents).toStrictEqual([]);
  });

  test.each<EveningDispatchReadiness>([
    { kind: 'waiting', missing: ['tournament-week.evening-bracket'] },
    { kind: 'dispatch-requested' },
    { kind: 'already-requested' },
  ])(
    '準備の完了の戻り値($kind)はログにだけ使い、処理を変えない',
    async (readiness) => {
      const fixture = eveningJobOf({
        readiness,
        created: [entryIdOf(1), entryIdOf(2)],
        late: [entryIdOf(3)],
        drawn: [2027],
        advanced: 4,
      });

      await fixture.job.run(jobContextOf(EVENING_TIME));

      expect(fixture.log.at(-1)).toBe('markReady');
      expect(fixture.reporter.incidents).toStrictEqual([]);
      expect(yearTournamentLogs()).toStrictEqual([
        {
          level: 'info',
          properties: {
            date: JOB_DATE,
            created: 2,
            late: 1,
            drawn: [2027],
            advanced: 4,
            readiness: readiness.kind,
            missingParticipants:
              readiness.kind === 'waiting' ? readiness.missing : [],
          },
        },
      ]);
    },
  );

  test('準備の完了の受け付けの拒否(EveningDispatchError)は失敗の通知へ渡さず、そのまま伝わる', async () => {
    const failure = new EveningDispatchError('unknown-participant');
    const fixture = eveningJobOf({ markFailure: failure });

    const outcome = fixture.job.run(jobContextOf(EVENING_TIME));

    expect(await outcome.catch((error: unknown) => error)).toBe(failure);
    expect(fixture.reporter.incidents).toStrictEqual([]);
  });

  interface FailureCase {
    readonly name: string;
    readonly options: EveningJobOptions;
    readonly failedSteps: readonly YearEveningBracketStep[];
    readonly failedYears: readonly number[];
  }

  const ensureError = new Error('年の行の用意の失敗');
  const openPeriodError = new Error('期間の起点の照会の失敗');
  const syncError = new Error('Week優勝の取り込みの失敗');
  const drawError = new Error('組み合わせ決定の失敗');
  const advanceError = new Error('進行の失敗');
  const publishError = new Error('一括の発行の失敗');

  const FAILURE_CASES: readonly FailureCase[] = [
    {
      name: '年の行の用意の例外',
      options: { ensureFailure: ensureError },
      failedSteps: ['calendar'],
      failedYears: [],
    },
    {
      name: '期間の起点の照会の例外',
      options: { openPeriodFailure: openPeriodError },
      failedSteps: ['entry-sync'],
      failedYears: [],
    },
    {
      name: 'Week優勝の取り込みの例外',
      options: { syncFailure: syncError },
      failedSteps: ['entry-sync'],
      failedYears: [],
    },
    {
      name: '組み合わせ決定の例外',
      options: { drawFailure: drawError },
      failedSteps: ['draw'],
      failedYears: [],
    },
    {
      name: '進行の例外',
      options: { advanceFailure: advanceError },
      failedSteps: ['progression'],
      failedYears: [],
    },
    {
      name: '一括の発行の例外',
      options: { publishFailure: publishError },
      failedSteps: ['evening-notification'],
      failedYears: [],
    },
    {
      name: '組み合わせ決定が返す失敗した年',
      options: { drawFailed: [2027] },
      failedSteps: [],
      failedYears: [2027],
    },
    {
      name: '進行が返す失敗した年',
      options: { advanceFailed: [2026, 2027] },
      failedSteps: [],
      failedYears: [2026, 2027],
    },
  ];

  test.each(FAILURE_CASES)(
    '$nameでは残りの段も行い、失敗の通知へ渡したうえで準備の完了を伝えずに例外になる',
    async ({ options, failedSteps, failedYears }) => {
      const fixture = eveningJobOf(options);

      const outcome = fixture.job.run(jobContextOf(EVENING_TIME));

      expect(await outcome.then(() => 'resolved').catch(() => 'rejected')).toBe(
        'rejected',
      );
      for (const step of ATTEMPTED_STEPS) {
        expect(fixture.log).toContain(step);
      }
      expect(fixture.log).not.toContain('markReady');
      expect(fixture.log.at(-1)).toBe('report:evening-bracket-failed');
      expect(fixture.reporter.incidents).toStrictEqual([
        {
          kind: 'evening-bracket-failed',
          date: JOB_DATE,
          failedSteps,
          failedYears,
        },
      ]);
    },
  );

  test('年の行の用意に失敗しても、Week優勝の取り込みを行う', async () => {
    const fixture = eveningJobOf({ ensureFailure: ensureError });

    await fixture.job.run(jobContextOf(EVENING_TIME)).catch(() => undefined);

    expect(fixture.log).toContain('syncChampions');
  });

  test('期間の起点を読めなければ、下限を誤らないようWeek優勝の取り込みを呼ばない', async () => {
    const fixture = eveningJobOf({ openPeriodFailure: openPeriodError });

    await fixture.job.run(jobContextOf(EVENING_TIME)).catch(() => undefined);

    expect(fixture.log).not.toContain('syncChampions');
  });

  test('例外が1つだけなら、その例外をそのまま投げる', async () => {
    const fixture = eveningJobOf({ advanceFailure: advanceError });

    const outcome = fixture.job.run(jobContextOf(EVENING_TIME));

    expect(await outcome.catch((error: unknown) => error)).toBe(advanceError);
  });

  test('複数の段が例外を投げたら、すべての例外をまとめて投げ、失敗した年は重複を除いて知らせる', async () => {
    const fixture = eveningJobOf({
      ensureFailure: ensureError,
      drawFailure: drawError,
      publishFailure: publishError,
      advanceFailed: [2027, 2027],
    });

    const thrown = await fixture.job
      .run(jobContextOf(EVENING_TIME))
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toStrictEqual([
      ensureError,
      drawError,
      publishError,
    ]);
    expect(fixture.reporter.incidents).toStrictEqual([
      {
        kind: 'evening-bracket-failed',
        date: JOB_DATE,
        failedSteps: ['calendar', 'draw', 'evening-notification'],
        failedYears: [2027],
      },
    ]);
  });

  test('失敗した年だけがあれば、その件数を示す例外を投げる', async () => {
    const fixture = eveningJobOf({
      drawFailed: [2027],
      advanceFailed: [2026, 2027],
    });

    const thrown = await fixture.job
      .run(jobContextOf(EVENING_TIME))
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(AggregateError);
    expect((thrown as Error).message).toBe(
      'Yearトーナメントの組み合わせ決定・進行に失敗した年があります: 2件',
    );
    expect(fixture.reporter.incidents).toStrictEqual([
      {
        kind: 'evening-bracket-failed',
        date: JOB_DATE,
        failedSteps: [],
        failedYears: [2027, 2026],
      },
    ]);
  });
});

describe('YearEntryFollowUpJob', () => {
  function followUpJobOf(
    pending: readonly YearEntryRecord[] = [],
    failures: { readonly list?: Failure; readonly process?: Failure } = {},
  ) {
    const log: CallLog = [];
    const store = createFakeFollowUpEntryStore(log, pending, failures.list);
    const followUp = createFakeYearEntryFollowUp(log, failures.process);
    const reporter = createLoggingIncidentReporter(log);
    const job = new YearEntryFollowUpJob(store, followUp, reporter, {
      now: () => FOLLOW_UP_NOW,
    });
    return { job, log, store, followUp, reporter };
  }

  const PENDING = [
    pendingEntryOf(1, 2027),
    pendingEntryOf(2, null),
    pendingEntryOf(3, 2026),
    pendingEntryOf(4, 2027),
  ];

  test('10分以上前に更新した返金待ち・知らせ待ちの枠を100件まで読み、再処理する', async () => {
    const fixture = followUpJobOf(PENDING);

    await fixture.job.run();

    expect(YEAR_ENTRY_FOLLOW_UP_STALE_AFTER_MS).toBe(600_000);
    expect(YEAR_ENTRY_FOLLOW_UP_LIMIT).toBe(100);
    expect(fixture.store.pendingReads).toStrictEqual([
      {
        olderThan: new Date(FOLLOW_UP_NOW.getTime() - 600_000 + 1),
        limit: 100,
      },
    ]);
    expect(fixture.followUp.processed).toStrictEqual([
      {
        entryIds: PENDING.map(({ entryId }) => entryId),
        now: FOLLOW_UP_NOW,
      },
    ]);
    expect(fixture.reporter.incidents).toStrictEqual([]);
    expect(yearTournamentLogs()).toStrictEqual([
      { level: 'info', properties: { entries: 4 } },
    ]);
  });

  test('対象の枠が無ければ再処理を呼ばない', async () => {
    const fixture = followUpJobOf();

    await fixture.job.run();

    expect(fixture.log).toStrictEqual(['listPendingFollowUps']);
  });

  test('再処理の例外は対象の年(重複を除いた昇順、年の無い枠を除く)と件数とともに失敗の通知へ渡し、投げ直す', async () => {
    const failure = new Error('返金の依頼の失敗');
    const fixture = followUpJobOf(PENDING, { process: failure });

    const thrown = await fixture.job.run().catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(fixture.log).toStrictEqual([
      'listPendingFollowUps',
      'process',
      'report:entry-follow-up-failed',
    ]);
    expect(fixture.reporter.incidents).toStrictEqual([
      { kind: 'entry-follow-up-failed', years: [2026, 2027], entryCount: 4 },
    ]);
  });

  test('対象の読み取りの例外も失敗の通知へ渡し、投げ直す', async () => {
    const failure = new Error('読み取りの失敗');
    const fixture = followUpJobOf(PENDING, { list: failure });

    const thrown = await fixture.job.run().catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(fixture.reporter.incidents).toStrictEqual([
      { kind: 'entry-follow-up-failed', years: [], entryCount: 0 },
    ]);
  });
});
