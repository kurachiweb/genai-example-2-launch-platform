import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import {
  EveningDispatchError,
  type EveningDispatchReadiness,
} from '../../../lib/core/notifications/evening-dispatch.ts';
import type { MatchRecord } from '../../../lib/core/match/ports.ts';
import type { WeekEntryRecord } from '../../../lib/core/week-tournament/ports.ts';
import type { WeekEveningBracketStep } from './ports.ts';
import {
  type CallLog,
  CLOCK_STEP_MS,
  createFakeDrawService,
  createFakeEveningDispatchGate,
  createFakeFollowUp,
  createFakeFollowUpStore,
  createFakeMatchDirectory,
  createFakeNotificationPublisher,
  createFakeProgressionService,
  createFakeRegistrar,
  createLoggingIncidentReporter,
  createSteppingClock,
  entryRecordOf,
  type Failure,
  JOB_DATE,
  jobContextOf,
  matchIdOf,
  qualifierOf,
  scheduledAt,
  tournamentIdOf,
} from './testing/week-tournament-job-fakes.ts';
import { WEEK_TOURNAMENT_API_TYPES } from './week-tournament-api-types.ts';
import {
  ENTRY_FOLLOW_UP_JOB_DEFINITION,
  ENTRY_FOLLOW_UP_LIMIT,
  ENTRY_FOLLOW_UP_STALE_AFTER_MS,
  EntryFollowUpJob,
  EVENING_BRACKET_JOB_DEFINITION,
  EVENING_BRACKET_PARTICIPANT,
  EveningBracketJob,
} from './week-tournament-jobs.ts';

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

function weekTournamentLogs() {
  return records
    .filter(
      (record) =>
        record.category.join('.') === 'api.application.week-tournament',
    )
    .map(({ level, properties }) => ({ level, properties }));
}

const EVENING_TIME = scheduledAt(JOB_DATE, { hour: 23, minute: 45 });
const EVENING_NOW = new Date(EVENING_TIME.getTime() + 2_000);
const DECIDED_AT = scheduledAt(JOB_DATE, { hour: 23, minute: 40 }, 5_000);
const FOLLOW_UP_TIME = scheduledAt(JOB_DATE, { hour: 4, minute: 21 });
const FOLLOW_UP_NOW = new Date(FOLLOW_UP_TIME.getTime() + 3_000);

function atStep(start: Date, step: number): Date {
  return new Date(start.getTime() + step * CLOCK_STEP_MS);
}

interface EveningJobOptions {
  readonly drawn?: readonly string[];
  readonly drawFailed?: readonly string[];
  readonly drawFailure?: Failure;
  readonly matches?: readonly MatchRecord[];
  readonly listFailure?: Failure;
  readonly registerFailures?: ReadonlyMap<string, Error>;
  readonly advanced?: number;
  readonly advanceFailed?: readonly string[];
  readonly advanceFailure?: Failure;
  readonly publishFailure?: Failure;
  readonly readiness?: EveningDispatchReadiness;
  readonly markFailure?: Failure;
}

function eveningJobOf(options: EveningJobOptions = {}) {
  const log: CallLog = [];
  const clock = createSteppingClock(EVENING_NOW);
  const draws = createFakeDrawService(
    log,
    { drawn: options.drawn ?? [], failed: options.drawFailed ?? [] },
    options.drawFailure,
  );
  const matches = createFakeMatchDirectory(
    log,
    options.matches ?? [],
    options.listFailure,
  );
  const registrar = createFakeRegistrar(log, options.registerFailures);
  const progression = createFakeProgressionService(
    log,
    { advanced: options.advanced ?? 0, failed: options.advanceFailed ?? [] },
    options.advanceFailure,
  );
  const notifications = createFakeNotificationPublisher(
    log,
    options.publishFailure,
  );
  const gate = createFakeEveningDispatchGate(
    log,
    options.readiness,
    options.markFailure,
  );
  const reporter = createLoggingIncidentReporter(log);
  const job = new EveningBracketJob(
    draws,
    matches,
    registrar,
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
    draws,
    matches,
    registrar,
    progression,
    notifications,
    gate,
    reporter,
  };
}

const ATTEMPTED_STEPS = [
  'drawDue',
  'listForDate',
  'advanceAll',
  'publishNight',
] as const;

describe('ジョブの定義', () => {
  test('23:45の夜の処理は1500でtournament-week.evening-bracketの名前とジョブの識別子を持つ', () => {
    expect(EVENING_BRACKET_JOB_DEFINITION).toStrictEqual({
      name: 'tournament-week.evening-bracket',
      at: { hour: 23, minute: 45 },
      order: 1500,
      handler: WEEK_TOURNAMENT_API_TYPES.EveningBracketJob,
    });
    expect(Object.isFrozen(EVENING_BRACKET_JOB_DEFINITION)).toBe(true);
  });

  test('夜の送り出しの前提の名前はジョブの名前と同じである', () => {
    expect(EVENING_BRACKET_PARTICIPANT).toBe(
      EVENING_BRACKET_JOB_DEFINITION.name,
    );
  });

  test('4:21の再処理は1500でtournament-week.entry-follow-upの名前とジョブの識別子を持つ', () => {
    expect(ENTRY_FOLLOW_UP_JOB_DEFINITION).toStrictEqual({
      name: 'tournament-week.entry-follow-up',
      at: { hour: 4, minute: 21 },
      order: 1500,
      handler: WEEK_TOURNAMENT_API_TYPES.EntryFollowUpJob,
    });
    expect(Object.isFrozen(ENTRY_FOLLOW_UP_JOB_DEFINITION)).toBe(true);
  });
});

describe('EveningBracketJob', () => {
  test('組み合わせ決定・確定した予選の追いつき・進行・夜の通知の発行の順に行い、最後に準備の完了を1回伝える', async () => {
    const fixture = eveningJobOf({
      drawn: [tournamentIdOf(1)],
      matches: [
        qualifierOf(1, DECIDED_AT),
        qualifierOf(2, null),
        qualifierOf(3, DECIDED_AT),
      ],
      advanced: 2,
    });

    await fixture.job.run(jobContextOf(EVENING_TIME));

    expect(fixture.log).toStrictEqual([
      'drawDue',
      'listForDate',
      `registerFromMatch:${matchIdOf(1)}`,
      `registerFromMatch:${matchIdOf(3)}`,
      'advanceAll',
      'publishNight',
      'markReady',
    ]);
    expect(fixture.draws.nows).toStrictEqual([EVENING_NOW]);
    expect(fixture.matches.dateReads).toStrictEqual([
      { date: JOB_DATE, kinds: ['qualifier'], now: EVENING_NOW },
    ]);
    expect(fixture.registrar.calls).toStrictEqual([
      { matchId: matchIdOf(1), at: EVENING_NOW },
      { matchId: matchIdOf(3), at: EVENING_NOW },
    ]);
    expect(fixture.progression.nows).toStrictEqual([EVENING_NOW]);
    expect(fixture.reporter.incidents).toStrictEqual([]);
  });

  test('夜の通知の発行と準備の完了には、それぞれ呼び出しの直前に読んだ時刻を渡す', async () => {
    const fixture = eveningJobOf();

    await fixture.job.run(jobContextOf(EVENING_TIME));

    expect(fixture.clock.reads).toStrictEqual([
      EVENING_NOW,
      atStep(EVENING_NOW, 1),
      atStep(EVENING_NOW, 2),
    ]);
    expect(fixture.notifications.nights).toStrictEqual([
      { date: JOB_DATE, at: atStep(EVENING_NOW, 1) },
    ]);
    expect(fixture.gate.inputs).toStrictEqual([
      {
        participant: 'tournament-week.evening-bracket',
        date: JOB_DATE,
        at: atStep(EVENING_NOW, 2),
      },
    ]);
  });

  test('組み合わせも確定した予選も進行も無い夜も、夜の通知を発行して準備の完了を伝える', async () => {
    const fixture = eveningJobOf();

    await fixture.job.run(jobContextOf(EVENING_TIME));

    expect(fixture.log).toStrictEqual([
      'drawDue',
      'listForDate',
      'advanceAll',
      'publishNight',
      'markReady',
    ]);
  });

  test.each<EveningDispatchReadiness>([
    { kind: 'waiting', missing: ['tournament-year.evening-bracket'] },
    { kind: 'dispatch-requested' },
    { kind: 'already-requested' },
  ])(
    '準備の完了の戻り値($kind)はログにだけ使い、処理を変えない',
    async (readiness) => {
      const fixture = eveningJobOf({ readiness, drawn: [tournamentIdOf(1)] });

      await fixture.job.run(jobContextOf(EVENING_TIME));

      expect(fixture.log.at(-1)).toBe('markReady');
      expect(fixture.reporter.incidents).toStrictEqual([]);
      expect(weekTournamentLogs()).toStrictEqual([
        {
          level: 'info',
          properties: {
            date: JOB_DATE,
            drawn: 1,
            catchUpMatches: 0,
            advanced: 0,
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
    readonly failedSteps: readonly WeekEveningBracketStep[];
    readonly failedTournamentIds: readonly string[];
  }

  const drawError = new Error('組み合わせ決定の失敗');
  const listError = new Error('マッチの照会の失敗');
  const registerError = new Error('枠の作成の失敗');
  const advanceError = new Error('進行の失敗');
  const publishError = new Error('発行の失敗');

  const FAILURE_CASES: readonly FailureCase[] = [
    {
      name: '組み合わせ決定の例外',
      options: { drawFailure: drawError },
      failedSteps: ['draw'],
      failedTournamentIds: [],
    },
    {
      name: '確定した予選の照会の例外',
      options: { listFailure: listError },
      failedSteps: ['entry-catch-up'],
      failedTournamentIds: [],
    },
    {
      name: '確定した予選の枠の作成の例外',
      options: {
        matches: [qualifierOf(1, DECIDED_AT), qualifierOf(2, DECIDED_AT)],
        registerFailures: new Map([[matchIdOf(1), registerError]]),
      },
      failedSteps: ['entry-catch-up'],
      failedTournamentIds: [],
    },
    {
      name: '進行の例外',
      options: { advanceFailure: advanceError },
      failedSteps: ['progression'],
      failedTournamentIds: [],
    },
    {
      name: '夜の通知の発行の例外',
      options: { publishFailure: publishError },
      failedSteps: ['night-notification'],
      failedTournamentIds: [],
    },
    {
      name: '組み合わせ決定が返す失敗の一覧',
      options: { drawFailed: [tournamentIdOf(1)] },
      failedSteps: [],
      failedTournamentIds: [tournamentIdOf(1)],
    },
    {
      name: '進行が返す失敗の一覧',
      options: { advanceFailed: [tournamentIdOf(2), tournamentIdOf(3)] },
      failedSteps: [],
      failedTournamentIds: [tournamentIdOf(2), tournamentIdOf(3)],
    },
  ];

  test.each(FAILURE_CASES)(
    '$nameでは他の処理も試し、失敗の通知へ渡したうえで準備の完了を伝えずに例外になる',
    async ({ options, failedSteps, failedTournamentIds }) => {
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
          failedTournamentIds,
        },
      ]);
    },
  );

  test('確定した予選の1件の枠の作成に失敗しても、残りのマッチの枠を作る', async () => {
    const fixture = eveningJobOf({
      matches: [qualifierOf(1, DECIDED_AT), qualifierOf(2, DECIDED_AT)],
      registerFailures: new Map([[matchIdOf(1), registerError]]),
    });

    const outcome = fixture.job.run(jobContextOf(EVENING_TIME));

    expect(await outcome.catch((error: unknown) => error)).toBe(registerError);
    expect(fixture.registrar.calls.map(({ matchId }) => matchId)).toStrictEqual(
      [matchIdOf(1), matchIdOf(2)],
    );
  });

  test('例外が1つだけなら、その例外をそのまま投げる', async () => {
    const fixture = eveningJobOf({ advanceFailure: advanceError });

    const outcome = fixture.job.run(jobContextOf(EVENING_TIME));

    expect(await outcome.catch((error: unknown) => error)).toBe(advanceError);
  });

  test('複数の手順が例外を投げたら、すべての例外をまとめて投げる', async () => {
    const fixture = eveningJobOf({
      drawFailure: drawError,
      publishFailure: publishError,
      drawFailed: [],
      advanceFailed: [tournamentIdOf(4)],
    });

    const thrown = await fixture.job
      .run(jobContextOf(EVENING_TIME))
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toStrictEqual([
      drawError,
      publishError,
    ]);
    expect(fixture.reporter.incidents).toStrictEqual([
      {
        kind: 'evening-bracket-failed',
        date: JOB_DATE,
        failedSteps: ['draw', 'night-notification'],
        failedTournamentIds: [tournamentIdOf(4)],
      },
    ]);
  });

  test('同じ枠の作成で複数のマッチが失敗したら、その手順の例外をまとめる', async () => {
    const otherError = new Error('別の枠の作成の失敗');
    const fixture = eveningJobOf({
      matches: [qualifierOf(1, DECIDED_AT), qualifierOf(2, DECIDED_AT)],
      registerFailures: new Map([
        [matchIdOf(1), registerError],
        [matchIdOf(2), otherError],
      ]),
    });

    const thrown = await fixture.job
      .run(jobContextOf(EVENING_TIME))
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toStrictEqual([
      registerError,
      otherError,
    ]);
    expect(fixture.reporter.incidents).toStrictEqual([
      {
        kind: 'evening-bracket-failed',
        date: JOB_DATE,
        failedSteps: ['entry-catch-up'],
        failedTournamentIds: [],
      },
    ]);
  });

  test('失敗の一覧だけが空でなければ、失敗したトーナメントの件数を示す例外を投げる', async () => {
    const fixture = eveningJobOf({
      drawFailed: [tournamentIdOf(1)],
      advanceFailed: [tournamentIdOf(1), tournamentIdOf(2)],
    });

    const thrown = await fixture.job
      .run(jobContextOf(EVENING_TIME))
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(AggregateError);
    expect((thrown as Error).message).toBe(
      'Weekトーナメントの組み合わせ決定・進行に失敗したトーナメントがあります: 2件',
    );
    expect(fixture.reporter.incidents).toStrictEqual([
      {
        kind: 'evening-bracket-failed',
        date: JOB_DATE,
        failedSteps: [],
        failedTournamentIds: [tournamentIdOf(1), tournamentIdOf(2)],
      },
    ]);
  });
});

describe('EntryFollowUpJob', () => {
  function followUpJobOf(
    pending: readonly WeekEntryRecord[] = [],
    failures: { readonly list?: Failure; readonly process?: Failure } = {},
  ) {
    const log: CallLog = [];
    const store = createFakeFollowUpStore(log, pending, failures.list);
    const followUp = createFakeFollowUp(log, failures.process);
    const reporter = createLoggingIncidentReporter(log);
    const job = new EntryFollowUpJob(store, followUp, reporter, {
      now: () => FOLLOW_UP_NOW,
    });
    return { job, log, store, followUp, reporter };
  }

  const PENDING = [
    entryRecordOf(1, tournamentIdOf(1)),
    entryRecordOf(2, tournamentIdOf(2)),
    entryRecordOf(3, tournamentIdOf(1)),
  ];

  test('10分以上前に更新した返金待ち・知らせ待ちの枠を100件まで読み、再処理する', async () => {
    const fixture = followUpJobOf(PENDING);

    await fixture.job.run();

    expect(ENTRY_FOLLOW_UP_STALE_AFTER_MS).toBe(600_000);
    expect(ENTRY_FOLLOW_UP_LIMIT).toBe(100);
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
    expect(weekTournamentLogs()).toStrictEqual([
      { level: 'info', properties: { entries: 3 } },
    ]);
  });

  test('対象の枠が無ければ再処理を呼ばない', async () => {
    const fixture = followUpJobOf();

    await fixture.job.run();

    expect(fixture.log).toStrictEqual(['listPendingFollowUps']);
  });

  test('再処理の例外は対象のトーナメントとともに失敗の通知へ渡し、投げ直す', async () => {
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
      {
        kind: 'entry-follow-up-failed',
        tournamentIds: [tournamentIdOf(1), tournamentIdOf(2)],
        entryCount: 3,
      },
    ]);
  });

  test('対象の読み取りの例外も失敗の通知へ渡し、投げ直す', async () => {
    const failure = new Error('読み取りの失敗');
    const fixture = followUpJobOf(PENDING, { list: failure });

    const thrown = await fixture.job.run().catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(fixture.reporter.incidents).toStrictEqual([
      { kind: 'entry-follow-up-failed', tournamentIds: [], entryCount: 0 },
    ]);
  });
});
