import { resetSync } from '@logtape/logtape';
import { asc, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { paymentRefunds } from '../../../db/schema/payments/payment-refunds.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import { createUlidGenerator } from '../../core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../core/messaging/contracts/index.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import type { SponsorshipRecord } from '../../core/sponsorship/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../core/time/business-time.ts';
import type { Clock } from '../../core/time/clock.ts';
import { createMessagePublisher } from '../messaging/queue-publisher.ts';
import { D1PurchaseStore } from '../payments/d1-purchase-store.ts';
import { D1RefundStore } from '../payments/d1-refund-store.ts';
import { D1PaymentRefunds } from '../payments/payment-refunds.ts';
import { D1DisplayStopStore } from './d1-display-stop-store.ts';
import { D1SponsorshipStore } from './d1-sponsorship-store.ts';
import { D1RefundSettlement, type RefundPlan } from './refund-settlement.ts';
import {
  clearSponsorshipTables,
  createSequentialSponsorshipIds,
  db,
  insertDisplayStops,
  insertSponsorProduct,
  insertSponsorships,
  insertSponsorshipPurchase,
  insertSponsorUser,
  NOW,
  paidColumnsOf,
  productIdOf,
  readSponsorshipRow,
  sponsorshipIdOf,
  sponsorshipPurchaseIdOf,
  terminatedColumnsOf,
} from './testing/sponsorship-fixtures.ts';

const OWNER = 1;
const PURCHASE_ID = sponsorshipPurchaseIdOf(1);
const SETTLED_AT = new Date('2026-11-25T08:07:00.000Z');

// 11-10〜11-16の7日間・7,000セント(1日1,000セント)
const ENDED_PERIOD = Object.freeze({
  startsOn: '2026-11-10',
  endsOn: '2026-11-16',
  days: 7,
});

const clock: Clock = { now: () => NOW };

interface RecordingQueue {
  readonly queue: Queue<QueueEnvelope>;
  readonly sent: QueueEnvelope[];
}

function createRecordingQueue(): RecordingQueue {
  const sent: QueueEnvelope[] = [];
  const queue: Queue<QueueEnvelope> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

let queue: RecordingQueue = createRecordingQueue();

function settlement(): D1RefundSettlement {
  const ids = createUlidGenerator(clock);
  const refundStore = new D1RefundStore(db);
  const refunds = new D1PaymentRefunds({
    appName: 'event',
    db,
    purchases: new D1PurchaseStore(db),
    refunds: refundStore,
    refundStatements: refundStore,
    publisher: createMessagePublisher(
      queue.queue,
      MESSAGE_CONTRACTS,
      ids,
      clock,
    ),
    ids,
    clock,
  });
  return new D1RefundSettlement({
    appName: 'event',
    displayStops: new D1DisplayStopStore(db),
    refundStatements: refunds,
    refunds,
  });
}

async function readRecord(): Promise<SponsorshipRecord> {
  const record = await new D1SponsorshipStore(
    db,
    createSequentialSponsorshipIds(),
  ).findById(sponsorshipIdOf(1));
  if (record === undefined) {
    throw new Error('申込が見つからない');
  }
  return record;
}

async function readRefundRows(): Promise<
  (typeof paymentRefunds.$inferSelect)[]
> {
  return db
    .select()
    .from(paymentRefunds)
    .orderBy(asc(paymentRefunds.requestKey));
}

async function commit(items: readonly BatchItem<'sqlite'>[]): Promise<void> {
  const [first, ...rest] = items;
  if (first === undefined) {
    return;
  }
  await db.batch([first, ...rest]);
}

async function commitPeriodEnd(
  record: SponsorshipRecord,
  plan: RefundPlan,
): Promise<void> {
  await commit([
    settlement().periodEndStatement(record, plan, SETTLED_AT, db),
    ...plan.statements,
  ]);
}

const today = (value: string): BusinessDate => parseBusinessDate(value);

async function arrange(refundedAmount = 0): Promise<void> {
  await insertSponsorUser(OWNER);
  await insertSponsorProduct({ index: 1, owner: OWNER });
  await insertSponsorships([
    {
      index: 1,
      owner: OWNER,
      product: 1,
      columns: paidColumnsOf(1, ENDED_PERIOD),
    },
  ]);
  await insertSponsorshipPurchase({ index: 1, owner: OWNER, refundedAmount });
  // 11-12 10:00から11-14 0:00ちょうどまで(11-12・11-13の2日)
  await insertDisplayStops([
    {
      index: 1,
      subject: { kind: 'product', productId: productIdOf(1) },
      startedAt: new Date('2026-11-12T18:00:00.000Z'),
      endedAt: new Date('2026-11-14T08:00:00.000Z'),
    },
  ]);
}

beforeEach(async () => {
  await clearSponsorshipTables();
  queue = createRecordingQueue();
});

afterAll(() => {
  resetSync();
});

describe('D1RefundSettlement 掲載の終わりの精算', () => {
  test('計画の文と申込の列の更新の文を一括で確定すると、返金の依頼の行と申込の列がそろって確定し、確定の後に依頼を送る', async () => {
    await arrange();
    const record = await readRecord();

    const plan = await settlement().planPeriodEnd(record);
    await commitPeriodEnd(record, plan);
    await settlement().dispatch([plan]);

    const [refund, ...others] = await readRefundRows();
    expect(others).toEqual([]);
    expect(refund).toMatchObject({
      id: plan.refundRequestId,
      purchaseId: PURCHASE_ID,
      requestKey: `sponsorship:${PURCHASE_ID}:sponsorship_display_stopped`,
      amount: 2_000,
      reason: 'sponsorship_display_stopped',
      status: 'requested',
      dispatchedAt: NOW,
    });
    expect(await readSponsorshipRow(1)).toMatchObject({
      stopRefundStatus: 'requested',
      stopRefundDays: 2,
      stopRefundAmount: 2_000,
      stopRefundRequestId: plan.refundRequestId,
      updatedAt: SETTLED_AT,
    });
    expect(queue.sent).toHaveLength(1);
  });

  test('同じ依頼キーで計画し直しても新しい依頼の行を作らない', async () => {
    await arrange();
    const record = await readRecord();
    const first = await settlement().planPeriodEnd(record);
    await commit(first.statements);

    const second = await settlement().planPeriodEnd(record);

    expect(second).toMatchObject({
      status: 'requested',
      refundRequestId: first.refundRequestId,
      statements: [],
    });
    expect(await readRefundRows()).toHaveLength(1);
  });

  test.each([
    ['申込の論理削除', { deletedAt: SETTLED_AT }],
    ['プロダクトの論理削除', { productDeletedAt: SETTLED_AT }],
    ['精算済み', { stopRefundStatus: 'not_needed' as const }],
    ['強制終了', terminatedColumnsOf(1, ENDED_PERIOD)],
  ])(
    '計画の後に%sで条件が崩れると、返金の依頼の行と申込の列の更新の両方が取り消される',
    async (_label, columns) => {
      await arrange();
      const record = await readRecord();
      const plan = await settlement().planPeriodEnd(record);
      await db
        .update(sponsorships)
        .set(columns)
        .where(eq(sponsorships.id, sponsorshipIdOf(1)));

      await expect(commitPeriodEnd(record, plan)).rejects.toThrow();

      expect(await readRefundRows()).toEqual([]);
      expect(await readSponsorshipRow(1)).toMatchObject({
        stopRefundDays: null,
        stopRefundAmount: null,
        stopRefundRequestId: null,
      });
    },
  );

  test('管理者が全額を返金済みの購入は、依頼の行を作らずに返金済みとして記録する', async () => {
    await arrange(7_000);
    const record = await readRecord();

    const plan = await settlement().planPeriodEnd(record);
    await commitPeriodEnd(record, plan);

    expect(plan).toMatchObject({
      status: 'already_refunded',
      statements: [],
      incident: {
        incident: 'refund-already-settled',
        code: 'amount_exceeds_refundable',
      },
    });
    expect(
      (await readRefundRows()).map(({ requestKey }) => requestKey),
    ).toEqual([`admin:${PURCHASE_ID}`]);
    expect(await readSponsorshipRow(1)).toMatchObject({
      stopRefundStatus: 'already_refunded',
      stopRefundDays: 2,
      stopRefundAmount: 2_000,
      stopRefundRequestId: null,
    });
  });
});

describe('D1RefundSettlement 強制終了の精算', () => {
  test('未掲載日数分と強制終了日の前日までの表示停止日数分の2つの依頼の行を、別の依頼キーで確定する', async () => {
    await arrange();
    const record = await readRecord();

    const plans = await settlement().planTermination(
      record,
      today('2026-11-14'),
    );
    await commit([
      ...plans.termination.statements,
      ...plans.displayStop.statements,
    ]);

    expect(
      (await readRefundRows()).map(({ requestKey, amount, reason }) => ({
        requestKey,
        amount,
        reason,
      })),
    ).toEqual([
      {
        requestKey: `sponsorship:${PURCHASE_ID}:sponsorship_display_stopped`,
        amount: 2_000,
        reason: 'sponsorship_display_stopped',
      },
      {
        requestKey: `sponsorship:${PURCHASE_ID}:sponsorship_terminated`,
        amount: 3_000,
        reason: 'sponsorship_terminated',
      },
    ]);
  });

  test('返金できる残りが未掲載日数分に足りなければ残りの全額で依頼し、表示停止は依頼せずに返金済みにする', async () => {
    await arrange(6_000);
    const record = await readRecord();

    const plans = await settlement().planTermination(
      record,
      today('2026-11-14'),
    );
    await commit([
      ...plans.termination.statements,
      ...plans.displayStop.statements,
    ]);

    expect(plans.termination).toMatchObject({
      days: 3,
      amount: null,
      status: 'requested',
    });
    expect(plans.displayStop).toMatchObject({
      days: 2,
      amount: 2_000,
      status: 'already_refunded',
      statements: [],
    });
    expect(
      (await readRefundRows()).map(({ requestKey, amount }) => ({
        requestKey,
        amount,
      })),
    ).toEqual([
      { requestKey: `admin:${PURCHASE_ID}`, amount: 6_000 },
      {
        requestKey: `sponsorship:${PURCHASE_ID}:sponsorship_terminated`,
        amount: 1_000,
      },
    ]);
  });
});
