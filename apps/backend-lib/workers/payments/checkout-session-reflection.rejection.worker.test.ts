import { resetSync } from '@logtape/logtape';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { CHECKOUT_CONSENT_VERSION } from '../../../common-lib/payments/checkout-consent.ts';
import { reflectionRequestKeyOf } from '../../core/payments/refund-rules.ts';
import {
  AMOUNT_PAID,
  CONSENTED_AT,
  createFakeFulfillment,
  harnessWith,
  insertPurchase,
  LINK_FUNDING_SOURCE_GROUP,
  minutesAfterT0,
  NOW,
  OCCURRED_AT,
  paymentIntentIdOf,
  PRICE,
  readGrants,
  readRefundRows,
  sessionIdOf,
  setStatus,
  snapshotOf,
} from './testing/checkout-reflection-harness.ts';
import {
  clearPaymentTables,
  insertUser,
  purchaseIdOf,
  readPurchaseRow,
  readRecords,
} from './testing/payment-store-fixtures.ts';

const EXCLUSIVITY_KEY = 'launch:1:week';

const LATE_DEADLINES = {
  deadlineAt: minutesAfterT0(10),
  acceptUntil: minutesAfterT0(5),
  // 反映の時刻(NOW)の1ミリ秒前
  fulfillableUntil: new Date(NOW.getTime() - 1),
};

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

afterAll(() => {
  resetSync();
});

describe('決済セッションの反映の拒否と全額返金', () => {
  test('反映の期限の後の支払いは口を呼ばずに拒否し、決済の記録と全額返金の依頼が同時に確定して確定後に送信される', async () => {
    await insertPurchase(1, LATE_DEADLINES);
    const fulfillment = createFakeFulfillment();
    const { reflection, queue, emails, notifierCalls } = harnessWith({
      fulfillment,
    });

    const outcome = await reflection.reflectSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'rejected' });
    expect(fulfillment.prepared).toEqual([]);
    expect(fulfillment.committed).toEqual([]);
    expect(await readRecords()).toMatchObject([
      {
        status: 'succeeded',
        amount: AMOUNT_PAID,
        stripeReference: sessionIdOf(1),
        consentedAt: CONSENTED_AT,
        consentVersion: CHECKOUT_CONSENT_VERSION,
        linkFundingSourceGroup: LINK_FUNDING_SOURCE_GROUP,
      },
    ]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'rejected',
      rejectionReason: 'late',
      stripePaymentIntentId: paymentIntentIdOf(1),
      amountTotal: AMOUNT_PAID,
      paidAt: NOW,
      reflectedAt: NOW,
      lastEventAt: OCCURRED_AT,
      confirmationEmailStatus: 'none',
    });
    const refunds = await readRefundRows();
    expect(refunds).toMatchObject([
      {
        purchaseId: purchaseIdOf(1),
        requestKey: reflectionRequestKeyOf(purchaseIdOf(1)),
        amount: AMOUNT_PAID,
        reason: 'late',
        status: 'requested',
        noticeStatus: 'pending',
        dispatchedAt: NOW,
      },
    ]);
    expect(queue.sent).toMatchObject([
      { body: { refundRequestId: refunds[0]?.id } },
    ]);
    expect(await readGrants()).toEqual([]);
    expect(emails.sent).toEqual([]);
    expect(notifierCalls).toEqual([]);
  });

  test('反映の期限ちょうどの支払いは期限内として権利を付与する', async () => {
    await insertPurchase(1, { ...LATE_DEADLINES, fulfillableUntil: NOW });

    const outcome = await harnessWith().reflection.reflectSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
  });

  test('口が付与できないと答えると拒否し、理由を付けて全額返金を依頼する', async () => {
    await insertPurchase(1);
    const fulfillment = createFakeFulfillment({
      plan: () => ({ kind: 'reject', reason: 'ineligible' }),
    });
    const { reflection, queue } = harnessWith({ fulfillment });

    const outcome = await reflection.reflectSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'rejected' });
    expect(fulfillment.prepared).toHaveLength(1);
    expect(fulfillment.committed).toEqual([]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'rejected',
      rejectionReason: 'ineligible',
    });
    expect(await readRefundRows()).toMatchObject([
      { reason: 'ineligible', amount: AMOUNT_PAID },
    ]);
    expect(await readRecords()).toHaveLength(1);
    expect(queue.sent).toHaveLength(1);
  });

  test('購入種別が未登録・無効なら付与できないとして拒否する', async () => {
    await insertPurchase(1);

    const outcome = await harnessWith({
      kinds: ['ultras'],
    }).reflection.reflectSnapshot(snapshotOf(1), OCCURRED_AT);

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'rejected' });
    expect(await readRefundRows()).toMatchObject([{ reason: 'ineligible' }]);
  });

  test('権利を付与済みの購入と同じ二重決済の判定の鍵の決済は、口を呼び直さずに二重決済として拒否する', async () => {
    await insertPurchase(1, {
      kind: 'sponsorship',
      exclusivityKey: EXCLUSIVITY_KEY,
    });
    await insertPurchase(2, {
      kind: 'sponsorship',
      exclusivityKey: EXCLUSIVITY_KEY,
    });
    const fulfillment = createFakeFulfillment();
    const { reflection, queue } = harnessWith({ fulfillment });
    await reflection.reflectSnapshot(snapshotOf(1), OCCURRED_AT);

    const outcome = await reflection.reflectSnapshot(
      snapshotOf(2),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'rejected' });
    expect(
      fulfillment.prepared.filter(
        ({ purchaseId }) => purchaseId === purchaseIdOf(2),
      ),
    ).toHaveLength(1);
    expect(fulfillment.committed.map(({ purchaseId }) => purchaseId)).toEqual([
      purchaseIdOf(1),
    ]);
    expect(await readPurchaseRow(purchaseIdOf(2))).toMatchObject({
      status: 'rejected',
      rejectionReason: 'duplicate',
    });
    expect(await readRefundRows()).toMatchObject([
      {
        purchaseId: purchaseIdOf(2),
        reason: 'duplicate',
        requestKey: reflectionRequestKeyOf(purchaseIdOf(2)),
      },
    ]);
    expect(await readGrants()).toHaveLength(1);
    expect(await readRecords()).toHaveLength(2);
    expect(queue.sent).toHaveLength(1);
  });

  test('拒否した購入の2回目の反映は反映済みを返し、返金を重ねて依頼しない', async () => {
    await insertPurchase(1, LATE_DEADLINES);
    const { reflection, queue } = harnessWith();
    await reflection.reflectSnapshot(snapshotOf(1), OCCURRED_AT);

    const outcome = await reflection.reflectSnapshot(snapshotOf(1), NOW);

    expect(outcome).toEqual({
      kind: 'already_applied',
      purchaseStatus: 'rejected',
    });
    expect(await readRefundRows()).toHaveLength(1);
    expect(await readRecords()).toHaveLength(1);
    expect(queue.sent).toHaveLength(1);
  });

  test('同時に拒否を反映しても、記録と返金の依頼は1回だけ確定する', async () => {
    await insertPurchase(1);
    const fulfillment = createFakeFulfillment({
      barrier: 2,
      plan: () => ({ kind: 'reject', reason: 'ineligible' }),
    });
    const returnUrl = harnessWith({ fulfillment });
    const webhook = harnessWith({ fulfillment });

    const outcomes = await Promise.all([
      returnUrl.reflection.reflectSnapshot(snapshotOf(1), NOW),
      webhook.reflection.reflectSnapshot(snapshotOf(1), OCCURRED_AT),
    ]);

    expect(outcomes).toContainEqual({
      kind: 'applied',
      purchaseStatus: 'rejected',
    });
    expect(outcomes).toContainEqual({
      kind: 'already_applied',
      purchaseStatus: 'rejected',
    });
    expect(await readRefundRows()).toHaveLength(1);
    expect(await readRecords()).toHaveLength(1);
    expect([...returnUrl.queue.sent, ...webhook.queue.sent]).toHaveLength(1);
  });
});

describe('決済セッションの反映の未払い・期限切れ', () => {
  test('支払いが確定していない完了は処理中にし、権利を付与せず決済履歴に記録しない', async () => {
    await insertPurchase(1);
    const fulfillment = createFakeFulfillment();
    const { reflection, emails } = harnessWith({ fulfillment });
    const unpaid = snapshotOf(1, {
      paymentStatus: 'unpaid',
      paymentIntentStatus: 'processing',
    });

    const outcome = await reflection.reflectSnapshot(unpaid, OCCURRED_AT);

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'processing' });
    expect(fulfillment.prepared).toEqual([]);
    expect(await readRecords()).toEqual([]);
    expect(await readGrants()).toEqual([]);
    expect(emails.sent).toEqual([]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'processing',
      stripePaymentIntentId: paymentIntentIdOf(1),
      amountTotal: AMOUNT_PAID,
      paidAt: null,
      reflectedAt: null,
      lastEventAt: OCCURRED_AT,
      confirmationEmailStatus: 'none',
    });
    expect(await reflection.reflectSnapshot(unpaid, NOW)).toEqual({
      kind: 'already_applied',
      purchaseStatus: 'processing',
    });
  });

  test('PaymentIntentがまだ無い未払いの完了も処理中にする', async () => {
    await insertPurchase(1);

    const outcome = await harnessWith().reflection.reflectSnapshot(
      snapshotOf(1, {
        paymentStatus: 'unpaid',
        paymentIntentId: null,
        paymentIntentStatus: null,
      }),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'processing' });
  });

  test('処理中の購入の支払いが失敗すると失効にし、決済履歴・返金の依頼・口の呼び出し・メールが起きない', async () => {
    await insertPurchase(1);
    const fulfillment = createFakeFulfillment();
    const { reflection, emails, queue } = harnessWith({ fulfillment });
    await reflection.reflectSnapshot(
      snapshotOf(1, {
        paymentStatus: 'unpaid',
        paymentIntentStatus: 'processing',
      }),
      OCCURRED_AT,
    );
    const failed = snapshotOf(1, {
      paymentStatus: 'unpaid',
      paymentIntentStatus: 'requires_payment_method',
    });

    const outcome = await reflection.reflectSnapshot(failed, NOW);

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'expired' });
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'expired',
      paidAt: null,
      lastEventAt: NOW,
    });
    expect(await readRecords()).toEqual([]);
    expect(await readRefundRows()).toEqual([]);
    expect(fulfillment.prepared).toEqual([]);
    expect(emails.sent).toEqual([]);
    expect(queue.sent).toEqual([]);
    expect(await reflection.reflectSnapshot(failed, NOW)).toEqual({
      kind: 'already_applied',
      purchaseStatus: 'expired',
    });
  });

  test.each(['requires_payment_method', 'canceled'])(
    '未完了の購入にPaymentIntentの状態が%sの完了を反映しても失効にする',
    async (paymentIntentStatus) => {
      await insertPurchase(1);

      const outcome = await harnessWith().reflection.reflectSnapshot(
        snapshotOf(1, { paymentStatus: 'unpaid', paymentIntentStatus }),
        OCCURRED_AT,
      );

      expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'expired' });
      expect(await readRecords()).toEqual([]);
      expect(await readRefundRows()).toEqual([]);
    },
  );

  test('処理中の購入は支払いの確定を反映した時点で権利を付与する', async () => {
    await insertPurchase(1);
    const fulfillment = createFakeFulfillment();
    const { reflection } = harnessWith({ fulfillment });
    await reflection.reflectSnapshot(
      snapshotOf(1, {
        paymentStatus: 'unpaid',
        paymentIntentStatus: 'processing',
      }),
      OCCURRED_AT,
    );

    const outcome = await reflection.reflectSnapshot(snapshotOf(1), NOW);

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(fulfillment.committed).toHaveLength(1);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
      paidAt: NOW,
    });
  });

  test('期限切れの決済セッションは購入を失効にし、決済履歴に記録せず口を呼ばない', async () => {
    await insertPurchase(1);
    await insertPurchase(2);
    await setStatus(2, 'superseded');
    const fulfillment = createFakeFulfillment();
    const { reflection } = harnessWith({ fulfillment });
    const expired = (index: number) =>
      snapshotOf(index, {
        status: 'expired',
        paymentStatus: 'unpaid',
        paymentIntentId: null,
        paymentIntentStatus: null,
        amountTotal: PRICE,
        linkFundingSourceGroup: null,
      });

    expect(await reflection.reflectSnapshot(expired(1), OCCURRED_AT)).toEqual({
      kind: 'applied',
      purchaseStatus: 'expired',
    });
    expect(await reflection.reflectSnapshot(expired(2), OCCURRED_AT)).toEqual({
      kind: 'applied',
      purchaseStatus: 'expired',
    });
    expect(await reflection.reflectSnapshot(expired(1), NOW)).toEqual({
      kind: 'already_applied',
      purchaseStatus: 'expired',
    });
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'expired',
      lastEventAt: OCCURRED_AT,
    });
    expect(await readRecords()).toEqual([]);
    expect(await readRefundRows()).toEqual([]);
    expect(fulfillment.prepared).toEqual([]);
  });

  test('まだ開いている決済セッションは購入を変えずに現在の状態を返す', async () => {
    await insertPurchase(1);

    const outcome = await harnessWith().reflection.reflectSnapshot(
      snapshotOf(1, { status: 'open', paymentStatus: 'unpaid' }),
      NOW,
    );

    expect(outcome).toEqual({
      kind: 'already_applied',
      purchaseStatus: 'open',
    });
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'open',
      lastEventAt: null,
    });
  });
});
