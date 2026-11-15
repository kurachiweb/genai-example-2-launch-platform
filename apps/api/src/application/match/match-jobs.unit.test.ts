import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { QUALIFIER_SCHEDULE } from '../../../lib/core/match/match-model.ts';
import {
  MATCH_EVENT_SWEEP_LIMIT,
  MATCH_EVENT_SWEEP_WINDOW_MS,
  MatchKickoffJob,
  MatchSettlementJob,
  QualifierPairingJob,
} from './match-jobs.ts';
import { MATCH_SETTLEMENT_TIME_LIMIT_MS } from './match-settlement.ts';
import {
  type CallLog,
  createFakeCompletionStore,
  createFakeSweepEventStore,
  createLoggingDispatcher,
  createLoggingIncidentReporter,
  createRecordingKickoff,
  createRecordingPairingService,
  createRecordingSettlement,
  fixedClock,
  JOB_DATE,
  jobContextOf,
  NEXT_DATE,
  scheduledAt,
  sweptEventIdOf,
} from './testing/match-job-fakes.ts';

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

function matchLogs() {
  return records
    .filter((record) => record.category.join('.') === 'api.application.match')
    .map(({ level, properties }) => ({ level, properties }));
}

const SETTLEMENT_TIME = scheduledAt(JOB_DATE, QUALIFIER_SCHEDULE.fullTime);
const PAIRING_TIME = scheduledAt(JOB_DATE, QUALIFIER_SCHEDULE.pairing);
const KICKOFF_TIME = scheduledAt(NEXT_DATE, QUALIFIER_SCHEDULE.kickoff);
const ONE_DAY_MS = 86_400_000;

function sweptPage(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    sweptEventIdOf(from + index),
  );
}

interface SettlementJobOptions {
  readonly now: Date;
  readonly settled?: number;
  readonly truncated?: boolean;
  readonly sweepPages?: readonly (readonly string[])[];
}

function settlementJobOf(options: SettlementJobOptions) {
  const log: CallLog = [];
  const events = createFakeSweepEventStore(log, options.sweepPages);
  const dispatcher = createLoggingDispatcher(log);
  const settlement = createRecordingSettlement(log, {
    settled: options.settled ?? 0,
    truncated: options.truncated ?? false,
  });
  const job = new MatchSettlementJob(
    settlement,
    events,
    dispatcher,
    fixedClock(options.now),
  );
  return { job, log, events, dispatcher, settlement };
}

function pairingJobOf(options: {
  readonly now: Date;
  readonly settled?: number;
}) {
  const log: CallLog = [];
  const events = createFakeSweepEventStore(log);
  const settlement = createRecordingSettlement(log, {
    settled: options.settled ?? 0,
    truncated: false,
  });
  const pairing = createRecordingPairingService(log, {
    launches: 9,
    matches: 5,
  });
  const reporter = createLoggingIncidentReporter(log);
  const job = new QualifierPairingJob(
    settlement,
    pairing,
    reporter,
    events,
    createLoggingDispatcher(log),
    fixedClock(options.now),
  );
  return { job, log, settlement, pairing, reporter };
}

function kickoffJobOf(options: {
  readonly now: Date;
  readonly completed: readonly (typeof JOB_DATE)[];
}) {
  const log: CallLog = [];
  const pairing = createRecordingPairingService(log, {
    launches: 4,
    matches: 2,
  });
  const completion = createFakeCompletionStore(log, options.completed);
  const kickoff = createRecordingKickoff(log);
  const reporter = createLoggingIncidentReporter(log);
  const job = new MatchKickoffJob(
    kickoff,
    pairing,
    completion,
    reporter,
    createFakeSweepEventStore(log),
    createLoggingDispatcher(log),
    fixedClock(options.now),
  );
  return { job, log, pairing, completion, kickoff, reporter };
}

describe('各ジョブの先頭の掃き出し', () => {
  test('偽の時計の時刻から2日前以降に確定し確定のイベントが無いマッチのイベントを、上限ずつ作って送る', async () => {
    const now = new Date(SETTLEMENT_TIME.getTime() + 5_000);
    const first = sweptPage(1, MATCH_EVENT_SWEEP_LIMIT);
    const second = sweptPage(MATCH_EVENT_SWEEP_LIMIT + 1, 3);
    const { job, events, dispatcher } = settlementJobOf({
      now,
      sweepPages: [first, second],
    });

    await job.run(jobContextOf(SETTLEMENT_TIME));

    expect(MATCH_EVENT_SWEEP_WINDOW_MS).toBe(2 * ONE_DAY_MS);
    expect(events.sweeps).toEqual([
      {
        decidedSince: new Date(now.getTime() - MATCH_EVENT_SWEEP_WINDOW_MS),
        at: now,
        limit: MATCH_EVENT_SWEEP_LIMIT,
      },
      {
        decidedSince: new Date(now.getTime() - MATCH_EVENT_SWEEP_WINDOW_MS),
        at: now,
        limit: MATCH_EVENT_SWEEP_LIMIT,
      },
    ]);
    expect(dispatcher.published).toEqual([first, second]);
  });

  test('作るイベントが無ければ送らず、1回の照会で終える', async () => {
    const { job, events, dispatcher } = settlementJobOf({
      now: SETTLEMENT_TIME,
    });

    await job.run(jobContextOf(SETTLEMENT_TIME));

    expect(events.sweeps).toHaveLength(1);
    expect(dispatcher.published).toEqual([]);
  });

  test('3つのジョブはいずれも、本来の処理より先に掃き出す', async () => {
    const settlement = settlementJobOf({ now: SETTLEMENT_TIME });
    const pairing = pairingJobOf({ now: PAIRING_TIME });
    const kickoff = kickoffJobOf({ now: KICKOFF_TIME, completed: [] });

    await settlement.job.run(jobContextOf(SETTLEMENT_TIME));
    await pairing.job.run(jobContextOf(PAIRING_TIME));
    await kickoff.job.run(jobContextOf(KICKOFF_TIME));

    expect(settlement.log[0]).toBe('sweep');
    expect(pairing.log[0]).toBe('sweep');
    expect(kickoff.log[0]).toBe('sweep');
  });
});

describe('MatchSettlementJob(23:40)', () => {
  test('予定時刻にMATCH_SETTLEMENT_TIME_LIMIT_MS(4分50秒)を足した打ち切りの時刻と、偽の時計の時刻を確定へ渡す', async () => {
    const now = new Date(SETTLEMENT_TIME.getTime() + 241_000);
    const { job, settlement } = settlementJobOf({ now });

    await job.run(jobContextOf(SETTLEMENT_TIME));

    expect(MATCH_SETTLEMENT_TIME_LIMIT_MS).toBe(290_000);
    expect(settlement.calls).toEqual([
      {
        now,
        deadline: new Date(
          SETTLEMENT_TIME.getTime() + MATCH_SETTLEMENT_TIME_LIMIT_MS,
        ),
      },
    ]);
  });

  test('確定の件数と打ち切りの有無、掃き出しの件数をinfoのログに出し、打ち切っても報告しない', async () => {
    const { job } = settlementJobOf({
      now: SETTLEMENT_TIME,
      settled: 120,
      truncated: true,
      sweepPages: [sweptPage(1, 2)],
    });

    await job.run(jobContextOf(SETTLEMENT_TIME));

    expect(matchLogs()).toEqual([
      {
        level: 'info',
        properties: { swept: 2, settled: 120, truncated: true },
      },
    ]);
  });
});

describe('QualifierPairingJob(23:45)', () => {
  test('先に打ち切りなしで確定し、確定したマッチがあれば件数を添えて遅れを報告してから翌日のペアリングを行う', async () => {
    const now = new Date(PAIRING_TIME.getTime() + 3_000);
    const { job, log, settlement, pairing, reporter } = pairingJobOf({
      now,
      settled: 7,
    });

    await job.run(jobContextOf(PAIRING_TIME));

    expect(log).toEqual([
      'sweep',
      'settle',
      'report:match-settlement-late',
      'pair',
    ]);
    expect(settlement.calls).toEqual([{ now }]);
    expect(reporter.incidents).toEqual([
      { kind: 'match-settlement-late', count: 7 },
    ]);
    expect(pairing.dates).toEqual([NEXT_DATE]);
  });

  test('確定したマッチが無ければ報告しない', async () => {
    const { job, reporter, pairing } = pairingJobOf({ now: PAIRING_TIME });

    await job.run(jobContextOf(PAIRING_TIME));

    expect(reporter.incidents).toEqual([]);
    expect(pairing.dates).toEqual([NEXT_DATE]);
  });

  test.each([
    ['23:44:59', scheduledAt(JOB_DATE, QUALIFIER_SCHEDULE.pairing, -1_000)],
    ['23:45:00', PAIRING_TIME],
  ])(
    '予定時刻が業務時刻%sでも、対象日は予定時刻の業務日付の翌日になる',
    async (_label, scheduledTime) => {
      const { job, pairing } = pairingJobOf({ now: scheduledTime });

      await job.run(jobContextOf(scheduledTime));

      expect(pairing.dates).toEqual([NEXT_DATE]);
    },
  );

  test('起動が遅れて偽の時計が予定時刻の翌日を指していても、対象日は予定時刻から求めて変わらない', async () => {
    const { job, pairing } = pairingJobOf({
      now: new Date(PAIRING_TIME.getTime() + ONE_DAY_MS),
    });

    await job.run(jobContextOf(PAIRING_TIME));

    expect(pairing.dates).toEqual([NEXT_DATE]);
  });

  test('確定とペアリングの件数をinfoのログに出す', async () => {
    const { job } = pairingJobOf({ now: PAIRING_TIME, settled: 2 });

    await job.run(jobContextOf(PAIRING_TIME));

    expect(matchLogs()).toEqual([
      {
        level: 'info',
        properties: {
          swept: 0,
          settled: 2,
          matchDate: NEXT_DATE,
          launches: 9,
          matches: 5,
        },
      },
    ]);
  });
});

describe('MatchKickoffJob(0:00)', () => {
  test('当日のペアリングが未完了なら、先にペアリングして件数を添えて遅れを報告し、偽の時計の時刻で開始する', async () => {
    const now = new Date(KICKOFF_TIME.getTime() + 4_000);
    const { job, log, completion, pairing, reporter, kickoff } = kickoffJobOf({
      now,
      completed: [JOB_DATE],
    });

    await job.run(jobContextOf(KICKOFF_TIME));

    expect(log).toEqual([
      'sweep',
      'isDayCompleted',
      'pair',
      'report:qualifier-pairing-late',
      'kickoff',
    ]);
    expect(completion.checked).toEqual([NEXT_DATE]);
    expect(pairing.dates).toEqual([NEXT_DATE]);
    expect(reporter.incidents).toEqual([
      { kind: 'qualifier-pairing-late', count: 2 },
    ]);
    expect(kickoff.nows).toEqual([now]);
  });

  test('当日のペアリングが完了済みなら、ペアリングも報告もせずに開始する', async () => {
    const { job, log, reporter } = kickoffJobOf({
      now: KICKOFF_TIME,
      completed: [NEXT_DATE],
    });

    await job.run(jobContextOf(KICKOFF_TIME));

    expect(log).toEqual(['sweep', 'isDayCompleted', 'kickoff']);
    expect(reporter.incidents).toEqual([]);
  });

  test('起動が遅れて偽の時計が予定時刻の翌日を指していても、回復の対象日は予定時刻の業務日付(当日)のまま変わらない', async () => {
    const late = new Date(KICKOFF_TIME.getTime() + ONE_DAY_MS);
    const { job, completion, pairing, kickoff } = kickoffJobOf({
      now: late,
      completed: [],
    });

    await job.run(jobContextOf(KICKOFF_TIME));

    expect(completion.checked).toEqual([NEXT_DATE]);
    expect(pairing.dates).toEqual([NEXT_DATE]);
    expect(kickoff.nows).toEqual([late]);
  });

  test('遅れたペアリングと開始・決着の件数をinfoのログに出す', async () => {
    const { job } = kickoffJobOf({ now: KICKOFF_TIME, completed: [] });

    await job.run(jobContextOf(KICKOFF_TIME));

    expect(matchLogs()).toEqual([
      {
        level: 'info',
        properties: {
          swept: 0,
          matchDate: NEXT_DATE,
          latePairedMatches: 2,
          started: 3,
          decided: 1,
        },
      },
    ]);
  });

  test('当日のペアリングが完了済みなら、遅れたペアリングの件数を0としてログに出す', async () => {
    const { job } = kickoffJobOf({ now: KICKOFF_TIME, completed: [NEXT_DATE] });

    await job.run(jobContextOf(KICKOFF_TIME));

    expect(matchLogs()).toEqual([
      {
        level: 'info',
        properties: {
          swept: 0,
          matchDate: NEXT_DATE,
          latePairedMatches: 0,
          started: 3,
          decided: 1,
        },
      },
    ]);
  });
});
