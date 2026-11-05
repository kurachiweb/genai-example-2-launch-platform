import { resetSync } from '@logtape/logtape';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { paymentRecords } from '../../../db/schema/payments/payment-records.ts';
import { AppError } from '../../core/errors/app-error.ts';
import type {
  NewPaymentRecord,
  RevenuePeriod,
} from '../../core/payments/ports.ts';
import { D1PaymentRevenueReport } from './d1-payment-revenue-report.ts';
import { recordLogs } from './testing/fake-stripe.ts';
import {
  after,
  clearPaymentTables,
  createRecordingDatabase,
  db,
  newPaymentRecord,
} from './testing/payment-store-fixtures.ts';

const MAX_BOUND_PARAMETERS = 100;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const report = new D1PaymentRevenueReport({ appName: 'api', db });

let nextIndex = 1;

async function insertRecord(columns: Partial<NewPaymentRecord>): Promise<void> {
  const index = nextIndex;
  nextIndex += 1;
  await db.insert(paymentRecords).values(
    newPaymentRecord(index, {
      purpose: 'sponsorship',
      stripeReference: `ref_${String(index)}`,
      ...columns,
    }),
  );
}

async function insertDispute(input: {
  readonly reference: string;
  readonly withdrawnAmount?: number;
  readonly withdrawnAt?: Date;
  readonly closing?: 'dispute_won' | 'dispute_lost';
  readonly closedAt?: Date;
  readonly purpose?: NewPaymentRecord['purpose'];
}): Promise<void> {
  const common = {
    kind: 'dispute',
    quantity: null,
    stripeReference: input.reference,
    purpose: input.purpose ?? 'sponsorship',
  } as const;
  if (input.withdrawnAmount !== undefined) {
    await insertRecord({
      ...common,
      status: 'disputed',
      amount: input.withdrawnAmount,
      occurredAt: input.withdrawnAt ?? after(0),
    });
  }
  if (input.closing !== undefined) {
    await insertRecord({
      ...common,
      status: input.closing,
      amount:
        input.closing === 'dispute_won' ? -(input.withdrawnAmount ?? 0) : 0,
      occurredAt: input.closedAt ?? after(0),
    });
  }
}

function dayPeriod(day: number): RevenuePeriod {
  return { from: after(day * DAY), to: after((day + 1) * DAY) };
}

async function expectBadRequest(
  periods: readonly RevenuePeriod[],
): Promise<void> {
  const failure = await report.netRevenue(periods).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(AppError);
  expect(failure).toMatchObject({ kind: 'bad_request' });
}

beforeEach(async () => {
  nextIndex = 1;
  await clearPaymentTables();
});

afterAll(() => {
  resetSync();
});

describe('D1PaymentRevenueReport', () => {
  test('成功した都度決済と請求の合計から、成功した返金を差し引く', async () => {
    await insertRecord({
      kind: 'one_time',
      amount: 5600,
      occurredAt: after(HOUR),
    });
    await insertRecord({
      kind: 'subscription',
      purpose: 'ultras',
      amount: 900,
      occurredAt: after(2 * HOUR),
    });
    await insertRecord({
      kind: 'refund',
      quantity: null,
      amount: -4800,
      occurredAt: after(3 * HOUR),
    });

    expect(await report.netRevenue([dayPeriod(0)])).toEqual([
      5600 + 900 - 4800,
    ]);
  });

  test('失敗と処理中の行と、疎通確認用の購入種別の行を含めない', async () => {
    await insertRecord({
      kind: 'one_time',
      amount: 5600,
      occurredAt: after(HOUR),
    });
    await insertRecord({
      kind: 'subscription',
      purpose: 'ultras',
      status: 'failed',
      amount: 900,
      occurredAt: after(HOUR),
    });
    await insertRecord({
      kind: 'refund',
      status: 'pending',
      quantity: null,
      amount: -5600,
      occurredAt: after(HOUR),
    });
    await insertRecord({
      kind: 'refund',
      status: 'failed',
      quantity: null,
      amount: -5600,
      occurredAt: after(HOUR),
    });
    await insertRecord({
      kind: 'one_time',
      purpose: 'payments_smoke',
      amount: 100,
      occurredAt: after(HOUR),
    });
    await insertRecord({
      kind: 'refund',
      purpose: 'payments_smoke',
      quantity: null,
      amount: -100,
      occurredAt: after(2 * HOUR),
    });
    await insertDispute({
      reference: 'dp_smoke',
      purpose: 'payments_smoke',
      withdrawnAmount: -100,
      closing: 'dispute_lost',
      closedAt: after(3 * HOUR),
    });

    expect(await report.netRevenue([dayPeriod(0)])).toEqual([5600]);
  });

  test('敗北が確定したチャージバックは、引き落としの額を敗北の時刻の期間に差し引く', async () => {
    await insertRecord({
      kind: 'one_time',
      amount: 5600,
      occurredAt: after(HOUR),
    });
    await insertDispute({
      reference: 'dp_lost',
      withdrawnAmount: -5600,
      withdrawnAt: after(DAY + HOUR),
      closing: 'dispute_lost',
      closedAt: after(2 * DAY + HOUR),
    });

    expect(
      await report.netRevenue([dayPeriod(0), dayPeriod(1), dayPeriod(2)]),
    ).toEqual([5600, 0, -5600]);
  });

  test('勝ったチャージバックと決着していないチャージバックは差し引かない', async () => {
    await insertRecord({
      kind: 'one_time',
      amount: 5600,
      occurredAt: after(HOUR),
    });
    await insertDispute({
      reference: 'dp_won',
      withdrawnAmount: -5600,
      withdrawnAt: after(2 * HOUR),
      closing: 'dispute_won',
      closedAt: after(3 * HOUR),
    });
    await insertDispute({
      reference: 'dp_open',
      withdrawnAmount: -3000,
      withdrawnAt: after(4 * HOUR),
    });

    expect(await report.netRevenue([dayPeriod(0)])).toEqual([5600]);
  });

  test('引き落としの行が無い敗北は0として数え、StripeのIDだけをwarningのログに残す', async () => {
    await insertRecord({
      kind: 'one_time',
      amount: 5600,
      occurredAt: after(HOUR),
      pseudonymousId: 'pseudonymous-secret',
    });
    await insertDispute({
      reference: 'dp_orphan',
      closing: 'dispute_lost',
      closedAt: after(2 * HOUR),
    });
    const logs = recordLogs();

    expect(await report.netRevenue([dayPeriod(0)])).toEqual([5600]);

    const warnings = logs.filter(({ method }) => method === 'warn');
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).toContain('dp_orphan');
    expect(JSON.stringify(logs)).not.toContain('pseudonymous-secret');
  });

  test('引き落としの行がある敗北だけならwarningのログを残さない', async () => {
    await insertDispute({
      reference: 'dp_lost',
      withdrawnAmount: -5600,
      closing: 'dispute_lost',
      closedAt: after(HOUR),
    });
    const logs = recordLogs();

    expect(await report.netRevenue([dayPeriod(0)])).toEqual([-5600]);
    expect(logs.filter(({ method }) => method === 'warn')).toHaveLength(0);
  });

  test('期間は開始の時刻を含み終わりの時刻を含まない', async () => {
    await insertRecord({ kind: 'one_time', amount: 100, occurredAt: after(0) });
    await insertRecord({
      kind: 'one_time',
      amount: 200,
      occurredAt: after(DAY - 1),
    });
    await insertRecord({
      kind: 'one_time',
      amount: 400,
      occurredAt: after(DAY),
    });

    expect(await report.netRevenue([dayPeriod(0), dayPeriod(1)])).toEqual([
      300, 400,
    ]);
  });

  test('結果は入力の順で、該当の無い期間と重なる期間もそれぞれ集計する', async () => {
    await insertRecord({
      kind: 'one_time',
      amount: 100,
      occurredAt: after(HOUR),
    });
    await insertRecord({
      kind: 'one_time',
      amount: 1000,
      occurredAt: after(3 * DAY + HOUR),
    });

    expect(
      await report.netRevenue([
        dayPeriod(3),
        dayPeriod(7),
        dayPeriod(0),
        { from: after(0), to: after(4 * DAY) },
      ]),
    ).toEqual([1000, 0, 100, 1100]);
  });

  test('60個の期間を1回の一括の実行で集計し、各文のバインド変数を上限内に収める', async () => {
    for (let day = 0; day < 60; day += 1) {
      await insertRecord({
        kind: 'one_time',
        amount: day + 1,
        occurredAt: after(day * DAY + HOUR),
      });
    }
    const recording = createRecordingDatabase();
    const recordingReport = new D1PaymentRevenueReport({
      appName: 'api',
      db: recording.database,
    });
    const periods = Array.from({ length: 60 }, (_, day) => dayPeriod(day));

    const revenue = await recordingReport.netRevenue(periods);

    expect(revenue).toEqual(periods.map((_, day) => day + 1));
    expect(recording.batchSizes).toHaveLength(1);
    expect(recording.batchSizes[0]).toBe(recording.placeholderCounts.length);
    expect(recording.placeholderCounts.length).toBeGreaterThan(2);
    expect(Math.max(...recording.placeholderCounts)).toBeLessThanOrEqual(
      MAX_BOUND_PARAMETERS,
    );
  });

  test('期間が0個・61個以上、開始が終わり以後、日時が不正な期間を拒否する', async () => {
    await expectBadRequest([]);
    await expectBadRequest(
      Array.from({ length: 61 }, (_, day) => dayPeriod(day)),
    );
    await expectBadRequest([
      dayPeriod(0),
      { from: after(DAY), to: after(DAY) },
    ]);
    await expectBadRequest([{ from: after(DAY), to: after(0) }]);
    await expectBadRequest([{ from: new Date(Number.NaN), to: after(DAY) }]);
  });
});
