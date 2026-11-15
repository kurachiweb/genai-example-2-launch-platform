import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../../lib/core/time/business-time.ts';
import type { AuditLogStore } from '../ports.ts';
import {
  AUDIT_LOG_DELETE_BATCH_SIZE,
  AUDIT_LOG_DELETE_MAX_BATCHES,
  auditLogRetentionCutoff,
  AuditLogRetentionJob,
} from './audit-log-retention-job.ts';

interface DeletionCall {
  readonly cutoff: Date;
  readonly limit: number;
}

const SCHEDULED_TIME = new Date('2026-11-15T12:21:00.000Z');

const CATEGORY = 'api.admin.audit-log-retention';

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
    cron: '21 12 * * *',
    business: toBusinessDateTime(scheduledTime),
  };
}

// 削除の各回の結果を順に返し、使い切った後は0件を返す
function setup(results: readonly (number | Error)[]) {
  const calls: DeletionCall[] = [];
  const store: AuditLogStore = {
    insert: () => Promise.reject(new Error('保存は呼ばれない想定です')),
    search: () => Promise.reject(new Error('検索は呼ばれない想定です')),
    latestFor: () => Promise.reject(new Error('照会は呼ばれない想定です')),
    latestForMany: () => Promise.reject(new Error('照会は呼ばれない想定です')),
    deleteOccurredUntil: (cutoff, limit) => {
      const result = results[calls.length] ?? 0;
      calls.push({ cutoff, limit });
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  };
  return { job: new AuditLogRetentionJob(store), calls };
}

function logsOfJob() {
  return records
    .filter((record) => record.category.join('.') === CATEGORY)
    .map(({ level, properties }) => ({ level, properties }));
}

describe('auditLogRetentionCutoff', () => {
  test.each([
    ['2026-11-15T12:21:00.000Z', '2023-11-15T12:21:00.000Z'],
    ['2028-03-01T12:21:00.123Z', '2025-03-01T12:21:00.123Z'],
    ['2028-02-29T12:21:00.000Z', '2025-02-28T12:21:00.000Z'],
    ['2027-02-28T12:21:00.000Z', '2024-02-28T12:21:00.000Z'],
  ])('実行時刻%sの3年前(UTCの暦の3年)は%sである', (scheduled, expected) => {
    expect(auditLogRetentionCutoff(new Date(scheduled))).toEqual(
      new Date(expected),
    );
  });
});

describe('AuditLogRetentionJob', () => {
  test('実行時刻の3年前以前に記録された監査ログを500件ずつ削除し、500件に満たない回で終える', async () => {
    const { job, calls } = setup([500, 500, 12]);

    await job.run(contextAt(SCHEDULED_TIME));

    expect(AUDIT_LOG_DELETE_BATCH_SIZE).toBe(500);
    expect(calls).toEqual(
      Array.from({ length: 3 }, () => ({
        cutoff: new Date('2023-11-15T12:21:00.000Z'),
        limit: 500,
      })),
    );
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: { deleted: 1012, batches: 3, limitReached: false },
      },
    ]);
  });

  test('1回の起動では最大20回までで止め、残りは翌日の起動に任せる', async () => {
    const { job, calls } = setup(Array.from({ length: 25 }, () => 500));

    await job.run(contextAt(SCHEDULED_TIME));

    expect(AUDIT_LOG_DELETE_MAX_BATCHES).toBe(20);
    expect(calls).toHaveLength(20);
    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: { deleted: 10_000, batches: 20, limitReached: true },
      },
    ]);
  });

  test('対象が無ければ1回の照会で終える', async () => {
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

  test('削除に失敗したら以降の回を行わず、それまでの件数をerrorで記録して投げ直す', async () => {
    const cause = new Error('D1に接続できません');
    const { job, calls } = setup([500, cause, 500]);

    const failure = await job
      .run(contextAt(SCHEDULED_TIME))
      .catch((error: unknown) => error);

    expect(failure).toBe(cause);
    expect(calls).toHaveLength(2);
    expect(logsOfJob()).toEqual([
      { level: 'error', properties: { error: cause, deleted: 500 } },
    ]);
  });
});
