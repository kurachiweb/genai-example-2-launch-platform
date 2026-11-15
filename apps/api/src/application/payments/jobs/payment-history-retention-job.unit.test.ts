import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import { PAYMENTS_TYPES } from '../../../../lib/core/payments/identifiers.ts';
import { createCronRegistry } from '../../../../lib/core/scheduling/cron-registry.ts';
import {
  createJobLogCapture,
  InMemoryRecordedAt,
  jobContextAt,
  SWEEP_TIME,
} from '../../../../test/support/payments-job-fakes.ts';
import { API_PAYMENTS_TYPES } from '../payments-types.ts';
import {
  PAYMENT_HISTORY_DELETE_BATCH_SIZE,
  PAYMENT_HISTORY_DELETE_MAX_BATCHES,
  PAYMENT_HISTORY_RETENTION_JOB_DEFINITION,
  paymentHistoryRetentionCutoff,
  PaymentHistoryRetentionJob,
} from './payment-history-retention-job.ts';

const CRON = '21 12 * * *';

const EXPECTED_CUTOFF = new Date('2020-04-06T12:21:00.000Z');

const logs = createJobLogCapture();

beforeEach(() => {
  logs.start();
});

afterEach(() => {
  logs.stop();
});

const recordedAtsBefore = (cutoff: Date, count: number): Date[] =>
  Array.from(
    { length: count },
    (_, index) => new Date(cutoff.getTime() - index - 1),
  );

function setup(
  recordedAts: readonly Date[],
  failures: ReadonlyMap<number, Error> = new Map(),
) {
  const records = new InMemoryRecordedAt(recordedAts, failures);
  return { job: new PaymentHistoryRetentionJob(records.store()), records };
}

const run = (job: PaymentHistoryRetentionJob) =>
  job.run(jobContextAt(SWEEP_TIME, CRON));

describe('paymentHistoryRetentionCutoff', () => {
  test.each([
    ['2027-04-06T12:21:00.000Z', '2020-04-06T12:21:00.000Z'],
    ['2031-12-31T12:21:00.123Z', '2024-12-31T12:21:00.123Z'],
    ['2031-02-28T12:21:00.000Z', '2024-02-28T12:21:00.000Z'],
    ['2032-02-29T12:21:00.000Z', '2025-02-28T12:21:00.000Z'],
  ])('実行時刻%sのUTCの暦で7年前は%sである', (scheduled, expected) => {
    expect(paymentHistoryRetentionCutoff(new Date(scheduled))).toEqual(
      new Date(expected),
    );
  });
});

describe('PAYMENT_HISTORY_RETENTION_JOB_DEFINITION', () => {
  test('業務時刻4:21・order 410で7年の削除のジョブを登録する定義である', () => {
    expect(PAYMENT_HISTORY_RETENTION_JOB_DEFINITION).toEqual({
      name: 'payments.history-retention',
      at: { hour: 4, minute: 21 },
      order: 410,
      handler: API_PAYMENTS_TYPES.PaymentHistoryRetentionJob,
    });
  });

  test('ジョブの定義の検証を通り、4:21の起動の式21 12 * * *で動く', () => {
    expect(
      createCronRegistry([
        PAYMENT_HISTORY_RETENTION_JOB_DEFINITION,
      ]).cronExpressions(),
    ).toEqual([CRON]);
  });
});

describe('PaymentHistoryRetentionJob', () => {
  test('記録日時が実行時刻の7年前より前の決済履歴を500件ずつ消し、500件に満たない回で終えて削除件数をinfoで記録する', async () => {
    const atCutoff = EXPECTED_CUTOFF;
    const { job, records } = setup([
      ...recordedAtsBefore(EXPECTED_CUTOFF, 1007),
      atCutoff,
    ]);

    await run(job);

    expect(PAYMENT_HISTORY_DELETE_BATCH_SIZE).toBe(500);
    expect(records.deletions).toEqual(
      Array.from({ length: 3 }, () => ({
        threshold: EXPECTED_CUTOFF,
        limit: 500,
      })),
    );
    expect(records.remaining()).toEqual([atCutoff]);
    expect(logs.of('history-retention')).toEqual([
      {
        level: 'info',
        properties: { deleted: 1007, batches: 3, limitReached: false },
      },
    ]);
  });

  test('1回の起動では最大20回までで止め、残りは翌日の起動に任せる', async () => {
    const { job, records } = setup(recordedAtsBefore(EXPECTED_CUTOFF, 10_001));

    await run(job);

    expect(PAYMENT_HISTORY_DELETE_MAX_BATCHES).toBe(20);
    expect(records.deletions).toHaveLength(20);
    expect(records.remaining()).toHaveLength(1);
    expect(logs.of('history-retention')).toEqual([
      {
        level: 'info',
        properties: { deleted: 10_000, batches: 20, limitReached: true },
      },
    ]);
  });

  test('対象が無ければ1回の削除で終え、0件を記録する', async () => {
    const { job, records } = setup([]);

    await run(job);

    expect(records.deletions).toHaveLength(1);
    expect(logs.of('history-retention')).toEqual([
      {
        level: 'info',
        properties: { deleted: 0, batches: 1, limitReached: false },
      },
    ]);
  });

  test('削除に失敗したら以降の回を行わず、例外をそのまま定期実行の記録へ投げる', async () => {
    const failure = new Error('D1に接続できません');
    const { job, records } = setup(
      recordedAtsBefore(EXPECTED_CUTOFF, 1500),
      new Map([[1, failure]]),
    );

    expect(await run(job).catch((error: unknown) => error)).toBe(failure);
    expect(records.deletions).toHaveLength(2);
    expect(records.remaining()).toHaveLength(1000);
    expect(logs.of('history-retention')).toEqual([]);
  });

  test('2回実行しても残る決済履歴は1回目の結果と変わらない', async () => {
    const kept = [EXPECTED_CUTOFF, new Date(EXPECTED_CUTOFF.getTime() + 1)];
    const { job, records } = setup([
      ...recordedAtsBefore(EXPECTED_CUTOFF, 3),
      ...kept,
    ]);

    await run(job);
    const afterFirst = records.remaining();
    await run(job);

    expect(records.remaining()).toEqual(afterFirst);
    expect(afterFirst).toEqual(kept);
    expect(records.deletions).toEqual([
      { threshold: EXPECTED_CUTOFF, limit: 500 },
      { threshold: EXPECTED_CUTOFF, limit: 500 },
    ]);
  });

  test('DIコンテナから共通の契約の識別子で決済履歴のストアを受け取って解決できる', async () => {
    const records = new InMemoryRecordedAt(
      recordedAtsBefore(EXPECTED_CUTOFF, 2),
    );
    const container = new Container();
    container
      .bind(PAYMENTS_TYPES.PaymentRecordStore)
      .toConstantValue(records.store());
    container
      .bind(API_PAYMENTS_TYPES.PaymentHistoryRetentionJob)
      .to(PaymentHistoryRetentionJob);

    await container
      .get<PaymentHistoryRetentionJob>(
        API_PAYMENTS_TYPES.PaymentHistoryRetentionJob,
      )
      .run(jobContextAt(SWEEP_TIME, CRON));

    expect(records.remaining()).toEqual([]);
  });
});
