import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import {
  MATCH_EVENT_CLEANUP_BATCH_SIZE,
  MATCH_EVENT_CLEANUP_MAX_BATCHES,
  MATCH_EVENT_REDISPATCH_LIMIT,
  MATCH_EVENT_RETENTION_MS,
  MATCH_EVENT_STALE_AFTER_MS,
  MATCH_EVENT_SWEEP_WINDOW_MS,
  MATCH_SETTLEMENT_OVERDUE_AFTER_MS,
  MatchEventCleanupJob,
  MatchEventRedispatchJob,
} from './match-jobs.ts';
import {
  createFakeMaintenanceEventStore,
  createFakeOverdueSettlementStore,
  type FakeMaintenanceEventStoreOptions,
  staleEventIdOf,
  staleEventOf,
} from './testing/maintenance-job-fakes.ts';
import {
  type CallLog,
  createLoggingDispatcher,
  createLoggingIncidentReporter,
  fixedClock,
  JOB_DATE,
  scheduledAt,
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

const MAINTENANCE_TIME = scheduledAt(JOB_DATE, { hour: 4, minute: 21 });
const NOW = new Date(MAINTENANCE_TIME.getTime() + 7_000);
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

function redispatchJobOf(
  options: FakeMaintenanceEventStoreOptions & { readonly overdue?: number },
) {
  const log: CallLog = [];
  const events = createFakeMaintenanceEventStore(log, options);
  const dispatcher = createLoggingDispatcher(log);
  const settlements = createFakeOverdueSettlementStore(
    log,
    options.overdue ?? 0,
  );
  const reporter = createLoggingIncidentReporter(log);
  const job = new MatchEventRedispatchJob(
    events,
    dispatcher,
    settlements,
    reporter,
    fixedClock(NOW),
  );
  return { job, log, events, dispatcher, settlements, reporter };
}

function cleanupJobOf(deletedPerCall: readonly number[]) {
  const log: CallLog = [];
  const events = createFakeMaintenanceEventStore(log, { deletedPerCall });
  const job = new MatchEventCleanupJob(events, fixedClock(NOW));
  return { job, log, events };
}

function staleEvents(count: number) {
  return Array.from({ length: count }, (_, index) =>
    staleEventOf(index + 1, new Date(NOW.getTime() - 2 * ONE_HOUR_MS)),
  );
}

describe('MatchEventRedispatchJob(4:21)', () => {
  test('先頭で、偽の時計の時刻から2日前以降に確定し確定のイベントが無いマッチを掃き出す', async () => {
    const { job, log, events } = redispatchJobOf({});

    await job.run();

    expect(log[0]).toBe('sweep');
    expect(MATCH_EVENT_SWEEP_WINDOW_MS).toBe(2 * ONE_DAY_MS);
    expect(events.sweeps).toEqual([
      {
        decidedSince: new Date(NOW.getTime() - MATCH_EVENT_SWEEP_WINDOW_MS),
        at: NOW,
      },
    ]);
  });

  test('最後の送信からちょうど1時間以上pendingのイベントを100件まで読み、送り直して回数を増やす', async () => {
    const { job, log, events, dispatcher } = redispatchJobOf({
      stale: staleEvents(MATCH_EVENT_REDISPATCH_LIMIT + 5),
    });

    await job.run();

    const expectedIds = Array.from(
      { length: MATCH_EVENT_REDISPATCH_LIMIT },
      (_, index) => staleEventIdOf(index + 1),
    );
    expect(MATCH_EVENT_STALE_AFTER_MS).toBe(ONE_HOUR_MS);
    expect(MATCH_EVENT_REDISPATCH_LIMIT).toBe(100);
    expect(events.staleReads).toEqual([
      {
        dispatchedBefore: new Date(NOW.getTime() - ONE_HOUR_MS + 1),
        limit: MATCH_EVENT_REDISPATCH_LIMIT,
      },
    ]);
    expect(dispatcher.published).toEqual([expectedIds]);
    expect(events.redispatched).toEqual([{ eventIds: expectedIds, at: NOW }]);
    expect(log.slice(0, 4)).toEqual([
      'sweep',
      'listStalePending',
      'publish',
      'markRedispatched',
    ]);
  });

  test('滞ったイベントが無ければ、送らず回数も変えない', async () => {
    const { job, events, dispatcher } = redispatchJobOf({});

    await job.run();

    expect(dispatcher.published).toEqual([]);
    expect(events.redispatched).toEqual([]);
  });

  test('終了の日時から1時間を過ぎて未確定のマッチがあれば、件数を添えてmatch-settlement-overdueを報告する', async () => {
    const { job, settlements, reporter } = redispatchJobOf({ overdue: 4 });

    await job.run();

    expect(MATCH_SETTLEMENT_OVERDUE_AFTER_MS).toBe(ONE_HOUR_MS);
    expect(settlements.overdueQueries).toEqual([
      new Date(NOW.getTime() - ONE_HOUR_MS),
    ]);
    expect(reporter.incidents).toEqual([
      { kind: 'match-settlement-overdue', count: 4 },
    ]);
  });

  test('終了の日時から1時間を過ぎて未確定のマッチが無ければ報告しない', async () => {
    const { job, reporter } = redispatchJobOf({ overdue: 0 });

    await job.run();

    expect(reporter.incidents).toEqual([]);
  });

  test('掃き出し・送り直し・未確定のマッチの件数をinfoのログに出す', async () => {
    const { job } = redispatchJobOf({ stale: staleEvents(3), overdue: 2 });

    await job.run();

    expect(matchLogs()).toEqual([
      {
        level: 'info',
        properties: { swept: 0, redispatched: 3, overdue: 2 },
      },
    ]);
  });
});

describe('MatchEventCleanupJob(4:21)', () => {
  test('偽の時計の時刻から30日より前に完了したイベントと処理の記録を500件ずつ、500件に満たない回まで削除する', async () => {
    const { job, events } = cleanupJobOf([
      MATCH_EVENT_CLEANUP_BATCH_SIZE,
      MATCH_EVENT_CLEANUP_BATCH_SIZE,
      12,
    ]);

    await job.run();

    const expected = {
      completedBefore: new Date(NOW.getTime() - 30 * ONE_DAY_MS),
      limit: 500,
    };
    expect(MATCH_EVENT_RETENTION_MS).toBe(30 * ONE_DAY_MS);
    expect(events.deletions).toEqual([expected, expected, expected]);
    expect(matchLogs()).toEqual([
      {
        level: 'info',
        properties: { deleted: 1012, batches: 3, limitReached: false },
      },
    ]);
  });

  test('毎回500件を消しても10回で止め、残りを翌日に任せる', async () => {
    const { job, events } = cleanupJobOf(
      Array.from({ length: 12 }, () => MATCH_EVENT_CLEANUP_BATCH_SIZE),
    );

    await job.run();

    expect(MATCH_EVENT_CLEANUP_MAX_BATCHES).toBe(10);
    expect(events.deletions).toHaveLength(10);
    expect(matchLogs()).toEqual([
      {
        level: 'info',
        properties: { deleted: 5000, batches: 10, limitReached: true },
      },
    ]);
  });

  test('削除の対象が無ければ1回の削除で終える', async () => {
    const { job, log } = cleanupJobOf([]);

    await job.run();

    expect(log).toEqual(['deleteCompletedBefore']);
  });
});
