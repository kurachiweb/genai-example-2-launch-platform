import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { ReportErasureStore } from '../../../../lib/core/reporting/ports.ts';
import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import { parseBusinessDate } from '../../../../lib/core/time/business-time.ts';
import { REPORTING_TYPES } from '../reporting-types.ts';
import {
  REPORT_DETACHED_CASE_ERASE_BATCH_SIZE,
  REPORT_EMPTY_CASE_ERASE_BATCH_SIZE,
  REPORT_ERASE_MAX_BATCHES,
  REPORT_GUEST_REPORT_ERASE_BATCH_SIZE,
  REPORT_RETENTION_JOB_DEFINITION,
  reportDetachedCaseRetentionCutoff,
  reportGuestRetentionThreshold,
  ReportRetentionJob,
} from './report-retention-job.ts';

// 業務日付2026-11-22の業務時刻4:21
const SCHEDULED_TIME = new Date('2026-11-22T12:21:00.000Z');
const FOURTEEN_DAYS_BEFORE = new Date('2026-11-08T12:21:00.000Z');
const THREE_YEARS_BEFORE = new Date('2023-11-22T12:21:00.000Z');
const CATEGORY = 'api.reporting.report-retention';

const CONTEXT: ScheduledJobContext = {
  scheduledTime: SCHEDULED_TIME,
  cron: '21 12 * * *',
  business: {
    date: parseBusinessDate('2026-11-22'),
    weekday: 7,
    hour: 4,
    minute: 21,
  },
};

type Stage = 'guest' | 'detached' | 'empty';

type StageResults = Readonly<
  Partial<Record<Stage, readonly (number | Error)[]>>
>;

// 各段の削除の結果を順に返し、使い切った後は0件を返す
function createJob(results: StageResults = {}) {
  const calls: string[] = [];
  const used: Record<Stage, number> = { guest: 0, detached: 0, empty: 0 };
  const next = (stage: Stage): Promise<number> => {
    const result = results[stage]?.[used[stage]] ?? 0;
    used[stage] += 1;
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  };
  const store: Pick<
    ReportErasureStore,
    | 'eraseGuestReportsClosedBefore'
    | 'eraseDetachedCasesBefore'
    | 'eraseEmptyCases'
  > = {
    eraseGuestReportsClosedBefore: (threshold, limit) => {
      calls.push(`guest:${threshold.toISOString()}:${String(limit)}`);
      return next('guest');
    },
    eraseDetachedCasesBefore: (threshold, limit) => {
      calls.push(`detached:${threshold.toISOString()}:${String(limit)}`);
      return next('detached');
    },
    eraseEmptyCases: (limit) => {
      calls.push(`empty:${String(limit)}`);
      return next('empty');
    },
  };
  return {
    job: new ReportRetentionJob(store as ReportErasureStore),
    calls,
  };
}

const repeat = (count: number, value: number): number[] =>
  Array.from({ length: count }, () => value);

const GUEST_CALL = `guest:${FOURTEEN_DAYS_BEFORE.toISOString()}:500`;
const DETACHED_CALL = `detached:${THREE_YEARS_BEFORE.toISOString()}:100`;
const EMPTY_CALL = 'empty:500';

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

function logsOfJob() {
  return records
    .filter((record) => record.category.join('.') === CATEGORY)
    .map(({ level, properties }) => ({ level, properties }));
}

describe('reportGuestRetentionThreshold', () => {
  test.each([
    ['2026-11-22T12:21:00.000Z', '2026-11-08T12:21:00.000Z'],
    ['2026-03-10T12:21:00.123Z', '2026-02-24T12:21:00.123Z'],
    ['2028-03-01T12:21:00.000Z', '2028-02-16T12:21:00.000Z'],
  ])('予定時刻%sの14日(14×24時間)前は%sである', (scheduled, expected) => {
    expect(reportGuestRetentionThreshold(new Date(scheduled))).toEqual(
      new Date(expected),
    );
  });
});

describe('reportDetachedCaseRetentionCutoff', () => {
  test.each([
    ['2026-11-22T12:21:00.000Z', '2023-11-22T12:21:00.000Z'],
    ['2028-02-29T12:21:00.456Z', '2025-02-28T12:21:00.456Z'],
    ['2027-03-01T12:21:00.000Z', '2024-03-01T12:21:00.000Z'],
  ])(
    '予定時刻%sのUTCの暦の3年前は%sで、同じ日が無ければ月末へ寄せる',
    (scheduled, expected) => {
      expect(reportDetachedCaseRetentionCutoff(new Date(scheduled))).toEqual(
        new Date(expected),
      );
    },
  );
});

describe('REPORT_RETENTION_JOB_DEFINITION', () => {
  test('業務時刻4:21・order 2010で保持期間の削除のジョブを登録する凍結した定義である', () => {
    expect(REPORT_RETENTION_JOB_DEFINITION).toEqual({
      name: 'content-reporting.report-retention',
      at: { hour: 4, minute: 21 },
      order: 2010,
      handler: REPORTING_TYPES.ReportRetentionJob,
    });
    expect(Object.isFrozen(REPORT_RETENTION_JOB_DEFINITION)).toBe(true);
    expect(Object.isFrozen(REPORT_RETENTION_JOB_DEFINITION.at)).toBe(true);
  });
});

describe('ReportRetentionJob', () => {
  test('未ログインの通報・参照を消した案件・空の案件の順に、各段の上限に満たない回まで削除し、件数をinfoで記録する', async () => {
    const { job, calls } = createJob({
      guest: [500, 3],
      detached: [100, 100, 7],
      empty: [12],
    });

    await job.run(CONTEXT);

    expect([
      REPORT_GUEST_REPORT_ERASE_BATCH_SIZE,
      REPORT_DETACHED_CASE_ERASE_BATCH_SIZE,
      REPORT_EMPTY_CASE_ERASE_BATCH_SIZE,
    ]).toEqual([500, 100, 500]);
    expect(calls).toEqual([
      GUEST_CALL,
      GUEST_CALL,
      DETACHED_CALL,
      DETACHED_CALL,
      DETACHED_CALL,
      EMPTY_CALL,
    ]);
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: {
          guestReports: { erased: 503, batches: 2, limitReached: false },
          detachedCases: { erased: 207, batches: 3, limitReached: false },
          emptyCases: { erased: 12, batches: 1, limitReached: false },
        },
      },
    ]);
  });

  test('各段は1回の起動で最大20回までで止めて次の段へ進み、残りは翌日の起動に任せる', async () => {
    const { job, calls } = createJob({
      guest: repeat(25, 500),
      detached: repeat(25, 100),
      empty: repeat(25, 500),
    });

    await job.run(CONTEXT);

    expect(REPORT_ERASE_MAX_BATCHES).toBe(20);
    expect(calls).toEqual([
      ...repeat(20, 0).map(() => GUEST_CALL),
      ...repeat(20, 0).map(() => DETACHED_CALL),
      ...repeat(20, 0).map(() => EMPTY_CALL),
    ]);
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: {
          guestReports: { erased: 10_000, batches: 20, limitReached: true },
          detachedCases: { erased: 2000, batches: 20, limitReached: true },
          emptyCases: { erased: 10_000, batches: 20, limitReached: true },
        },
      },
    ]);
  });

  test('ちょうど20回目が上限に満たなければ上限に達していないと記録する', async () => {
    const { job } = createJob({ guest: [...repeat(19, 500), 499] });

    await job.run(CONTEXT);

    expect(logsOfJob().at(-1)?.properties).toMatchObject({
      guestReports: { erased: 9999, batches: 20, limitReached: false },
    });
  });

  test('対象が無ければ各段を1回ずつ照会して終え、0件を記録する', async () => {
    const { job, calls } = createJob();

    await job.run(CONTEXT);

    expect(calls).toEqual([GUEST_CALL, DETACHED_CALL, EMPTY_CALL]);
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: {
          guestReports: { erased: 0, batches: 1, limitReached: false },
          detachedCases: { erased: 0, batches: 1, limitReached: false },
          emptyCases: { erased: 0, batches: 1, limitReached: false },
        },
      },
    ]);
  });

  test('削除に失敗したら以降の回と段を行わず、例外をそのまま定期実行の記録へ投げる', async () => {
    const cause = new Error('D1に接続できません');
    const { job, calls } = createJob({ detached: [100, cause, 100] });

    const failure = await job.run(CONTEXT).catch((error: unknown) => error);

    expect(failure).toBe(cause);
    expect(calls).toEqual([GUEST_CALL, DETACHED_CALL, DETACHED_CALL]);
    expect(logsOfJob()).toEqual([]);
  });

  test('起動が遅れても同じ予定時刻で再び実行すれば同じ閾値で削除する', async () => {
    const { job, calls } = createJob();

    await job.run(CONTEXT);
    await job.run(CONTEXT);

    expect(calls).toEqual([
      GUEST_CALL,
      DETACHED_CALL,
      EMPTY_CALL,
      GUEST_CALL,
      DETACHED_CALL,
      EMPTY_CALL,
    ]);
  });
});
