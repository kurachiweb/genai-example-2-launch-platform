import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../../lib/core/time/business-time.ts';
import { INQUIRY_TYPES } from '../inquiry-types.ts';
import type { GuestInquiryStore } from '../ports.ts';
import {
  GUEST_INQUIRY_DELETE_BATCH_SIZE,
  GUEST_INQUIRY_DELETE_MAX_BATCHES,
  GUEST_INQUIRY_RETENTION_JOB_DEFINITION,
  guestInquiryRetentionThreshold,
  GuestInquiryRetentionJob,
} from './guest-inquiry-retention-job.ts';

interface DeletionCall {
  readonly threshold: Date;
  readonly limit: number;
}

const SCHEDULED_TIME = new Date('2026-11-15T19:21:00.000Z');

const EXPECTED_THRESHOLD = new Date('2026-11-01T19:21:00.000Z');

const CATEGORY = 'api.inquiry.guest-inquiry-retention';

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

function contextAt(scheduledTime: Date): ScheduledJobContext {
  return {
    scheduledTime,
    cron: '21 19 * * *',
    business: toBusinessDateTime(scheduledTime),
  };
}

// 削除の各回の結果を順に返し、使い切った後は0件を返す
function setup(results: readonly (number | Error)[]) {
  const calls: DeletionCall[] = [];
  const store: GuestInquiryStore = {
    insert: () => Promise.reject(new Error('保存は呼ばれない想定です')),
    deleteClosedBefore: (threshold, limit) => {
      const result = results[calls.length] ?? 0;
      calls.push({ threshold, limit });
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  };
  return { job: new GuestInquiryRetentionJob(store), calls };
}

function logsOfJob() {
  return records
    .filter((record) => record.category.join('.') === CATEGORY)
    .map(({ level, properties }) => ({ level, properties }));
}

describe('guestInquiryRetentionThreshold', () => {
  test.each([
    ['2026-11-15T19:21:00.000Z', '2026-11-01T19:21:00.000Z'],
    ['2026-03-10T19:21:00.123Z', '2026-02-24T19:21:00.123Z'],
    ['2028-03-01T19:21:00.000Z', '2028-02-16T19:21:00.000Z'],
  ])('実行時刻%sの14日(14×24時間)前は%sである', (scheduled, expected) => {
    expect(guestInquiryRetentionThreshold(new Date(scheduled))).toEqual(
      new Date(expected),
    );
  });
});

describe('GUEST_INQUIRY_RETENTION_JOB_DEFINITION', () => {
  test('業務時刻4:21・order 300で保持期間のジョブを登録する定義である', () => {
    expect(GUEST_INQUIRY_RETENTION_JOB_DEFINITION).toEqual({
      name: 'inquiry-chat.guest-inquiry-retention',
      at: { hour: 4, minute: 21 },
      order: 300,
      handler: INQUIRY_TYPES.GuestInquiryRetentionJob,
    });
  });
});

describe('GuestInquiryRetentionJob', () => {
  test('実行時刻の14日前を閾値に500件ずつ削除し、500件に満たない回で終えて削除件数をinfoで記録する', async () => {
    const { job, calls } = setup([500, 500, 7]);

    await job.run(contextAt(SCHEDULED_TIME));

    expect(GUEST_INQUIRY_DELETE_BATCH_SIZE).toBe(500);
    expect(calls).toEqual(
      Array.from({ length: 3 }, () => ({
        threshold: EXPECTED_THRESHOLD,
        limit: 500,
      })),
    );
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: { deleted: 1007, batches: 3, limitReached: false },
      },
    ]);
  });

  test('1回の起動では最大20回までで止め、残りは翌日の起動に任せる', async () => {
    const { job, calls } = setup(Array.from({ length: 25 }, () => 500));

    await job.run(contextAt(SCHEDULED_TIME));

    expect(GUEST_INQUIRY_DELETE_MAX_BATCHES).toBe(20);
    expect(calls).toHaveLength(20);
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: { deleted: 10_000, batches: 20, limitReached: true },
      },
    ]);
  });

  test('ちょうど20回目が500件に満たなければ上限に達していないと記録する', async () => {
    const { job, calls } = setup([
      ...Array.from({ length: 19 }, () => 500),
      499,
    ]);

    await job.run(contextAt(SCHEDULED_TIME));

    expect(calls).toHaveLength(20);
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: { deleted: 9999, batches: 20, limitReached: false },
      },
    ]);
  });

  test('対象が無ければ1回の削除で終え、0件を記録する', async () => {
    const { job, calls } = setup([]);

    await job.run(contextAt(SCHEDULED_TIME));

    expect(calls).toHaveLength(1);
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: { deleted: 0, batches: 1, limitReached: false },
      },
    ]);
  });

  test('削除に失敗したら以降の回を行わず、例外をそのまま定期実行の記録へ投げる', async () => {
    const cause = new Error('D1に接続できません');
    const { job, calls } = setup([500, cause, 500]);

    const failure = await job
      .run(contextAt(SCHEDULED_TIME))
      .catch((error: unknown) => error);

    expect(failure).toBe(cause);
    expect(calls).toHaveLength(2);
    expect(logsOfJob()).toEqual([]);
  });

  test('同じ実行時刻で再び実行しても同じ閾値で削除する', async () => {
    const { job, calls } = setup([]);

    await job.run(contextAt(SCHEDULED_TIME));
    await job.run(contextAt(SCHEDULED_TIME));

    expect(calls).toEqual([
      { threshold: EXPECTED_THRESHOLD, limit: 500 },
      { threshold: EXPECTED_THRESHOLD, limit: 500 },
    ]);
  });
});
