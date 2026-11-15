import { resetSync } from '@logtape/logtape';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { paymentRefunds } from '../../../db/schema/payments/payment-refunds.ts';
import type {
  ReflectionInstruction,
  StripeDisputeBalanceTransaction,
} from '../../core/payments/ports.ts';
import { reflectionRequestKeyOf } from '../../core/payments/refund-rules.ts';
import { D1RefundStore } from './d1-refund-store.ts';
import {
  AMOUNT_PAID,
  createFakeFulfillment,
  type FakeFulfillment,
  insertPurchase,
  minutesAfterT0,
  NOW,
  OCCURRED_AT,
  paymentIntentIdOf,
  PSEUDONYMOUS_ID,
  readGrants,
  readRefundRows,
  sessionIdOf,
  snapshotOf,
} from './testing/checkout-reflection-harness.ts';
import {
  disputeIdOf,
  disputeOf,
  ownerMetadataOf,
  type PaymentReflectorHarness,
  reflectorWith,
  refundObjectIdOf,
  refundOf,
} from './testing/payment-reflector-harness.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  newRefundRequest,
  purchaseIdOf,
  readPurchaseRow,
  readRecords,
  refundIdOf,
} from './testing/payment-store-fixtures.ts';

const LATE_DEADLINES = {
  deadlineAt: minutesAfterT0(10),
  acceptUntil: minutesAfterT0(5),
  fulfillableUntil: new Date(NOW.getTime() - 1),
};

const WITHDRAWAL: StripeDisputeBalanceTransaction = {
  id: 'txn_withdrawal',
  amount: -AMOUNT_PAID,
};

const REINSTATEMENT: StripeDisputeBalanceTransaction = {
  id: 'txn_reinstatement',
  amount: AMOUNT_PAID,
};

function refundInstruction(minutes: number): ReflectionInstruction {
  return {
    kind: 'refund',
    refundId: refundObjectIdOf(1),
    occurredAt: minutesAfterT0(minutes),
  };
}

function disputeInstruction(
  stage: 'funds_withdrawn' | 'funds_reinstated' | 'closed',
  minutes: number,
): ReflectionInstruction {
  return {
    kind: 'dispute',
    disputeId: disputeIdOf(1),
    stage,
    occurredAt: minutesAfterT0(minutes),
  };
}

// 決済セッションの反映で、購入の状態とPaymentIntentのIDを保存する
async function reflectCheckout(
  options: {
    readonly late?: boolean;
    readonly fulfillment?: FakeFulfillment;
  } = {},
): Promise<PaymentReflectorHarness> {
  await insertPurchase(1, options.late === true ? LATE_DEADLINES : {});
  const harness = reflectorWith(
    options.fulfillment === undefined
      ? {}
      : { fulfillment: options.fulfillment },
  );
  harness.stripe.put({ kind: 'session', value: snapshotOf(1) });
  harness.stripe.putOwner({
    paymentIntentId: paymentIntentIdOf(1),
    metadata: ownerMetadataOf(1),
    subscriptionMetadata: null,
  });
  await harness.reflector.reflect({
    kind: 'checkout_session',
    sessionId: sessionIdOf(1),
    occurredAt: OCCURRED_AT,
  });
  return harness;
}

async function automaticRefundId(): Promise<string> {
  const [row] = await readRefundRows();
  if (row?.requestKey !== reflectionRequestKeyOf(purchaseIdOf(1))) {
    throw new Error('自動返金の依頼がありません');
  }
  return row.id;
}

async function setRefundUpdatedAt(id: string, updatedAt: Date): Promise<void> {
  await db
    .update(paymentRefunds)
    .set({ updatedAt })
    .where(eq(paymentRefunds.id, id));
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

afterAll(() => {
  resetSync();
});

describe('反映の処理の返金の記録', () => {
  test('自動返金を負の金額で記録して依頼の状態を進め、成功したときだけ返金の通知を依頼する', async () => {
    const harness = await reflectCheckout({ late: true });
    const refundRequestId = await automaticRefundId();
    const metadata = { refund_request_id: refundRequestId };
    harness.stripe.put({ kind: 'refund', value: refundOf(1, { metadata }) });

    expect(await harness.reflector.reflect(refundInstruction(31))).toEqual({
      kind: 'applied',
    });
    expect(await readRecords()).toContainEqual(
      expect.objectContaining({
        pseudonymousId: PSEUDONYMOUS_ID,
        kind: 'refund',
        purpose: 'payments_smoke',
        status: 'pending',
        amount: -AMOUNT_PAID,
        quantity: null,
        stripeReference: refundObjectIdOf(1),
        purchaseId: purchaseIdOf(1),
        consentedAt: null,
      }),
    );
    expect(await readRefundRows()).toMatchObject([
      {
        status: 'submitted',
        stripeRefundId: refundObjectIdOf(1),
        noticeStatus: 'pending',
      },
    ]);
    expect(harness.refundNoticeCalls).toEqual([]);

    harness.stripe.put({
      kind: 'refund',
      value: refundOf(1, { status: 'succeeded', metadata }),
    });
    expect(await harness.reflector.reflect(refundInstruction(32))).toEqual({
      kind: 'applied',
    });

    expect(
      (await readRecords()).filter(({ kind }) => kind === 'refund'),
    ).toMatchObject([{ status: 'succeeded', amount: -AMOUNT_PAID }]);
    expect(await readRefundRows()).toMatchObject([
      { status: 'succeeded', noticeStatus: 'requested' },
    ]);
    expect(harness.refundNoticeCalls).toEqual([refundRequestId]);
    expect(harness.emails.sent).toHaveLength(1);
    expect(harness.emails.sent[0]?.kind.name).toBe('payments.automatic-refund');
  });

  test('成功の後に同じ状態の通知が届いても依頼の更新日時(返金の日時)を変えず、通知を重ねて送らない', async () => {
    const harness = await reflectCheckout({ late: true });
    const refundRequestId = await automaticRefundId();
    harness.stripe.put({
      kind: 'refund',
      value: refundOf(1, {
        status: 'succeeded',
        metadata: { refund_request_id: refundRequestId },
      }),
    });
    await harness.reflector.reflect(refundInstruction(31));
    await setRefundUpdatedAt(refundRequestId, minutesAfterT0(31));

    expect(await harness.reflector.reflect(refundInstruction(33))).toEqual({
      kind: 'applied',
    });

    expect(await readRefundRows()).toMatchObject([
      { status: 'succeeded', updatedAt: minutesAfterT0(31) },
    ]);
    expect(harness.emails.sent).toHaveLength(1);
  });

  test('後続specの依頼の返金は、理由が反映の拒否と同じでも通知を依頼しない', async () => {
    const harness = await reflectCheckout();
    await db.batch([
      new D1RefundStore(db).insert(
        newRefundRequest(1, {
          purchaseId: purchaseIdOf(1),
          requestKey: 'tournament-week:1',
          reason: 'late',
        }),
      ),
    ]);
    harness.stripe.put({
      kind: 'refund',
      value: refundOf(1, {
        status: 'succeeded',
        metadata: { refund_request_id: refundIdOf(1) },
      }),
    });

    expect(await harness.reflector.reflect(refundInstruction(31))).toEqual({
      kind: 'applied',
    });

    expect(await readRefundRows()).toMatchObject([
      { id: refundIdOf(1), status: 'succeeded', noticeStatus: 'none' },
    ]);
    expect(harness.refundNoticeCalls).toEqual([]);
  });

  test('依頼の無い手動の返金も記録し、失敗の通知で失敗に更新する。権利の剥奪は依頼しない', async () => {
    const fulfillment = createFakeFulfillment();
    const harness = await reflectCheckout({ fulfillment });
    harness.stripe.put({ kind: 'refund', value: refundOf(1) });
    await harness.reflector.reflect(refundInstruction(31));
    harness.stripe.put({
      kind: 'refund',
      value: refundOf(1, {
        status: 'failed',
        failureReason: 'expired_or_canceled_card',
      }),
    });

    expect(await harness.reflector.reflect(refundInstruction(32))).toEqual({
      kind: 'applied',
    });

    expect(
      (await readRecords()).filter(({ kind }) => kind === 'refund'),
    ).toMatchObject([{ status: 'failed', amount: -AMOUNT_PAID }]);
    expect(await readRefundRows()).toEqual([]);
    expect(fulfillment.prepared).toHaveLength(1);
    expect(await readGrants()).toHaveLength(1);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
    });
  });

  test('本specの依頼の返金の失敗は、依頼を失敗にして理由を残す', async () => {
    const harness = await reflectCheckout({ late: true });
    const refundRequestId = await automaticRefundId();
    harness.stripe.put({
      kind: 'refund',
      value: refundOf(1, {
        status: 'failed',
        failureReason: 'lost_or_stolen_card',
        metadata: { refund_request_id: refundRequestId },
      }),
    });

    await harness.reflector.reflect(refundInstruction(31));

    expect(await readRefundRows()).toMatchObject([
      {
        status: 'failed',
        failureCode: 'lost_or_stolen_card',
        noticeStatus: 'pending',
      },
    ]);
    expect(harness.refundNoticeCalls).toEqual([]);
  });

  test('成功の後に届いた古い通知では、記録も依頼も処理中へ戻さない', async () => {
    const harness = await reflectCheckout({ late: true });
    const refundRequestId = await automaticRefundId();
    const metadata = { refund_request_id: refundRequestId };
    harness.stripe.put({
      kind: 'refund',
      value: refundOf(1, { status: 'succeeded', metadata }),
    });
    await harness.reflector.reflect(refundInstruction(33));
    harness.stripe.put({ kind: 'refund', value: refundOf(1, { metadata }) });

    expect(await harness.reflector.reflect(refundInstruction(31))).toEqual({
      kind: 'stale',
    });

    expect(
      (await readRecords()).filter(({ kind }) => kind === 'refund'),
    ).toMatchObject([{ status: 'succeeded', lastEventAt: minutesAfterT0(33) }]);
    expect(await readRefundRows()).toMatchObject([{ status: 'succeeded' }]);
  });

  test('Stripeに無い返金と、持ち主の分からない返金は反映しない', async () => {
    const harness = reflectorWith();
    expect(await harness.reflector.reflect(refundInstruction(31))).toEqual({
      kind: 'unresolved',
    });
    harness.stripe.put({ kind: 'refund', value: refundOf(1) });
    harness.stripe.putOwner({
      paymentIntentId: paymentIntentIdOf(1),
      metadata: {},
      subscriptionMetadata: null,
    });

    expect(await harness.reflector.reflect(refundInstruction(31))).toEqual({
      kind: 'unresolved',
    });
    expect(await readRecords()).toEqual([]);
  });
});

describe('反映の処理のチャージバックの記録', () => {
  test('引き落としと勝訴を段階ごとに符号付きの金額で記録し、同じ段階の2回目と勝訴の終了は記録しない。権利は変えない', async () => {
    const fulfillment = createFakeFulfillment();
    const harness = await reflectCheckout({ fulfillment });
    harness.stripe.put({
      kind: 'dispute',
      value: disputeOf(1, { balanceTransactions: [WITHDRAWAL] }),
    });

    expect(
      await harness.reflector.reflect(
        disputeInstruction('funds_withdrawn', 31),
      ),
    ).toEqual({ kind: 'applied' });
    expect(
      await harness.reflector.reflect(
        disputeInstruction('funds_withdrawn', 32),
      ),
    ).toEqual({ kind: 'already_applied' });
    harness.stripe.put({
      kind: 'dispute',
      value: disputeOf(1, {
        status: 'won',
        balanceTransactions: [WITHDRAWAL, REINSTATEMENT],
      }),
    });
    expect(
      await harness.reflector.reflect(
        disputeInstruction('funds_reinstated', 40),
      ),
    ).toEqual({ kind: 'applied' });
    expect(
      await harness.reflector.reflect(disputeInstruction('closed', 41)),
    ).toEqual({ kind: 'ignored' });

    const disputes = (await readRecords()).filter(
      ({ kind }) => kind === 'dispute',
    );
    expect(disputes).toHaveLength(2);
    expect(disputes).toContainEqual(
      expect.objectContaining({
        pseudonymousId: PSEUDONYMOUS_ID,
        purpose: 'payments_smoke',
        status: 'disputed',
        amount: -AMOUNT_PAID,
        stripeReference: disputeIdOf(1),
        purchaseId: purchaseIdOf(1),
        occurredAt: minutesAfterT0(31),
      }),
    );
    expect(disputes).toContainEqual(
      expect.objectContaining({
        status: 'dispute_won',
        amount: AMOUNT_PAID,
        occurredAt: minutesAfterT0(40),
      }),
    );
    expect(fulfillment.prepared).toHaveLength(1);
    expect(await readGrants()).toHaveLength(1);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
    });
  });

  test('不服申し立てを経て敗訴したチャージバックは、審査中と不服申し立ての段階を記録せず、係争中と敗訴の2行だけになる', async () => {
    const harness = await reflectCheckout();
    const stages = [
      ['under_review', 'funds_withdrawn', 'applied'],
      ['appeal_needs_response', 'funds_withdrawn', 'already_applied'],
      ['appeal_needs_response', 'closed', 'ignored'],
      ['appeal_under_review', 'closed', 'ignored'],
      ['lost', 'closed', 'applied'],
    ] as const;

    for (const [index, [status, stage, expected]] of stages.entries()) {
      harness.stripe.put({
        kind: 'dispute',
        value: disputeOf(1, { status, balanceTransactions: [WITHDRAWAL] }),
      });
      expect(
        await harness.reflector.reflect(disputeInstruction(stage, 31 + index)),
      ).toEqual({ kind: expected });
    }

    expect(
      (await readRecords())
        .filter(({ kind }) => kind === 'dispute')
        .map(({ status, amount }) => ({ status, amount })),
    ).toEqual(
      expect.arrayContaining([
        { status: 'disputed', amount: -AMOUNT_PAID },
        { status: 'dispute_lost', amount: 0 },
      ]),
    );
    expect(
      (await readRecords()).filter(({ kind }) => kind === 'dispute'),
    ).toHaveLength(2);
  });

  test('不服申し立てで勝訴したチャージバックは、係争中と勝訴の2行だけになる', async () => {
    const harness = await reflectCheckout();
    const stages = [
      ['under_review', [WITHDRAWAL], 'funds_withdrawn', 'applied'],
      ['appeal_under_review', [WITHDRAWAL], 'closed', 'ignored'],
      ['won', [WITHDRAWAL, REINSTATEMENT], 'funds_reinstated', 'applied'],
      ['won', [WITHDRAWAL, REINSTATEMENT], 'closed', 'ignored'],
    ] as const;

    for (const [index, [status, transactions, stage, expected]] of [
      ...stages.entries(),
    ]) {
      harness.stripe.put({
        kind: 'dispute',
        value: disputeOf(1, {
          status,
          balanceTransactions: [...transactions],
        }),
      });
      expect(
        await harness.reflector.reflect(disputeInstruction(stage, 31 + index)),
      ).toEqual({ kind: expected });
    }

    expect(
      (await readRecords())
        .filter(({ kind }) => kind === 'dispute')
        .map(({ status }) => status)
        .sort(),
    ).toEqual(['dispute_won', 'disputed']);
  });

  test('資金の移動の無い照会の段階と、異議申し立てに発展せずに終わったチャージバックは記録しない', async () => {
    const harness = await reflectCheckout();
    harness.stripe.put({
      kind: 'dispute',
      value: disputeOf(1, { status: 'warning_needs_response' }),
    });
    expect(
      await harness.reflector.reflect(
        disputeInstruction('funds_withdrawn', 31),
      ),
    ).toEqual({ kind: 'ignored' });
    harness.stripe.put({
      kind: 'dispute',
      value: disputeOf(1, { status: 'warning_closed' }),
    });

    expect(
      await harness.reflector.reflect(disputeInstruction('closed', 32)),
    ).toEqual({ kind: 'ignored' });
    expect(
      (await readRecords()).filter(({ kind }) => kind === 'dispute'),
    ).toEqual([]);
  });

  test('持ち主の分からないチャージバックは反映しない', async () => {
    const harness = reflectorWith();
    harness.stripe.put({
      kind: 'dispute',
      value: disputeOf(1, { balanceTransactions: [WITHDRAWAL] }),
    });
    harness.stripe.putOwner({
      paymentIntentId: paymentIntentIdOf(1),
      metadata: {},
      subscriptionMetadata: null,
    });

    expect(
      await harness.reflector.reflect(
        disputeInstruction('funds_withdrawn', 31),
      ),
    ).toEqual({ kind: 'unresolved' });
    expect(await readRecords()).toEqual([]);
  });
});
