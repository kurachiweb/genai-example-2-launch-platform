import { resetSync } from '@logtape/logtape';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { CHECKOUT_CONSENT_VERSION } from '../../../common-lib/payments/checkout-consent.ts';
import {
  StripeUnavailableError,
  type ReflectionInstruction,
} from '../../core/payments/ports.ts';
import {
  AMOUNT_PAID,
  CONSENTED_AT,
  createFakeFulfillment,
  insertPurchase,
  minutesAfterT0,
  NOW,
  OCCURRED_AT,
  PSEUDONYMOUS_ID,
  sessionIdOf,
  snapshotOf,
} from './testing/checkout-reflection-harness.ts';
import { recordLogs } from './testing/fake-stripe.ts';
import {
  invoiceIdOf,
  invoiceOf,
  ownerMetadataOf,
  type PaymentReflectorHarness,
  reflectorWith,
  subscriptionIdOf,
} from './testing/payment-reflector-harness.ts';
import {
  clearPaymentTables,
  insertUser,
  purchaseIdOf,
  readPurchaseRow,
  readRecords,
} from './testing/payment-store-fixtures.ts';

const ULTRAS_SESSION = snapshotOf(1, {
  invoiceId: invoiceIdOf(1),
  subscriptionId: subscriptionIdOf(1),
  metadata: ownerMetadataOf(1, 'ultras'),
});

function invoiceInstruction(
  index: number,
  occurredAt = OCCURRED_AT,
): ReflectionInstruction {
  return { kind: 'invoice', invoiceId: invoiceIdOf(index), occurredAt };
}

async function fulfillUltras(harness: PaymentReflectorHarness): Promise<void> {
  harness.stripe.put({ kind: 'session', value: ULTRAS_SESSION });
  await harness.reflector.reflect({
    kind: 'checkout_session',
    sessionId: sessionIdOf(1),
    occurredAt: OCCURRED_AT,
  });
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

afterAll(() => {
  resetSync();
});

describe('反映の処理の指示の振り分け', () => {
  test('決済セッションの指示は、Stripeから取得した決済セッションを決済セッションの反映へ渡す', async () => {
    await insertPurchase(1);
    const harness = reflectorWith();
    harness.stripe.put({ kind: 'session', value: snapshotOf(1) });

    const outcome = await harness.reflector.reflect({
      kind: 'checkout_session',
      sessionId: sessionIdOf(1),
      occurredAt: OCCURRED_AT,
    });

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(await readRecords()).toMatchObject([
      { kind: 'one_time', stripeReference: sessionIdOf(1) },
    ]);
    expect(
      await harness.reflector.reflect({
        kind: 'checkout_session',
        sessionId: sessionIdOf(1),
        occurredAt: NOW,
      }),
    ).toEqual({ kind: 'already_applied', purchaseStatus: 'fulfilled' });
  });

  test('取得済みの決済セッションは、Stripeを呼ばずに決済セッションの反映へ渡す', async () => {
    await insertPurchase(1);
    const harness = reflectorWith();

    const outcome = await harness.reflector.reflectCheckoutSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(harness.stripe.gateway.calls).toEqual([]);
  });

  test('受け付けない種類の通知は、Stripeを呼ばず何も書き込まずに無視する', async () => {
    const harness = reflectorWith();

    const outcome = await harness.reflector.reflect({
      kind: 'ignored',
      eventType: 'customer.created',
    });

    expect(outcome).toEqual({ kind: 'ignored' });
    expect(harness.stripe.gateway.calls).toEqual([]);
    expect(await readRecords()).toEqual([]);
  });
});

describe('反映の処理の請求の記録', () => {
  test('初回の請求の成功は、決済セッションの記録と同じ行を成功として更新する', async () => {
    await insertPurchase(1, { kind: 'ultras' });
    const harness = reflectorWith();
    await fulfillUltras(harness);
    harness.stripe.put({
      kind: 'invoice',
      value: invoiceOf(1, { amountPaid: AMOUNT_PAID }),
    });

    const outcome = await harness.reflector.reflect(
      invoiceInstruction(1, minutesAfterT0(29.5)),
    );

    expect(outcome).toEqual({ kind: 'applied' });
    const records = await readRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: 'subscription',
      purpose: 'ultras',
      status: 'succeeded',
      amount: AMOUNT_PAID,
      stripeReference: invoiceIdOf(1),
      purchaseId: purchaseIdOf(1),
      consentedAt: CONSENTED_AT,
      consentVersion: CHECKOUT_CONSENT_VERSION,
      lastEventAt: minutesAfterT0(29.5),
    });
  });

  test('請求が決済セッションより先に届いても同意が残り、決済セッションの反映はその行のIDを権利の付与へ渡す', async () => {
    await insertPurchase(1, { kind: 'ultras' });
    const fulfillment = createFakeFulfillment();
    const harness = reflectorWith({ fulfillment });
    harness.stripe.put({
      kind: 'invoice',
      value: invoiceOf(1, { amountPaid: AMOUNT_PAID }),
    });

    expect(await harness.reflector.reflect(invoiceInstruction(1))).toEqual({
      kind: 'applied',
    });
    await fulfillUltras(harness);

    const records = await readRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      pseudonymousId: PSEUDONYMOUS_ID,
      kind: 'subscription',
      status: 'succeeded',
      quantity: 1,
      purchaseId: purchaseIdOf(1),
      consentedAt: CONSENTED_AT,
      consentVersion: CHECKOUT_CONSENT_VERSION,
      recordedAt: NOW,
    });
    expect(fulfillment.committed).toMatchObject([
      { paymentRecordId: records[0]?.id },
    ]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
      stripeInvoiceId: invoiceIdOf(1),
    });
  });

  test('2回目以降の請求は別の行に記録し、同意と購入IDを写さず、購入確認メールを依頼しない', async () => {
    await insertPurchase(1, { kind: 'ultras' });
    const harness = reflectorWith();
    await fulfillUltras(harness);
    harness.stripe.put({ kind: 'invoice', value: invoiceOf(2) });

    const outcome = await harness.reflector.reflect(
      invoiceInstruction(2, minutesAfterT0(60)),
    );

    expect(outcome).toEqual({ kind: 'applied' });
    const renewal = (await readRecords()).find(
      ({ stripeReference }) => stripeReference === invoiceIdOf(2),
    );
    expect(renewal).toMatchObject({
      pseudonymousId: PSEUDONYMOUS_ID,
      kind: 'subscription',
      purpose: 'ultras',
      status: 'succeeded',
      amount: 500,
      purchaseId: null,
      consentedAt: null,
      consentVersion: null,
      linkFundingSourceGroup: null,
      occurredAt: minutesAfterT0(60),
    });
    expect(harness.notifierCalls).toHaveLength(1);
    expect(harness.refundNoticeCalls).toEqual([]);
    expect(harness.emails.sent).toHaveLength(1);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      confirmationEmailStatus: 'requested',
    });
  });

  test('支払いが失敗した請求を請求額の失敗として記録し、後の成功で更新し、古い通知では戻さない', async () => {
    const harness = reflectorWith();
    harness.stripe.put({
      kind: 'invoice',
      value: invoiceOf(2, { status: 'open', amountPaid: 0 }),
    });

    expect(
      await harness.reflector.reflect(invoiceInstruction(2, minutesAfterT0(1))),
    ).toEqual({ kind: 'applied' });
    expect(await readRecords()).toMatchObject([
      { status: 'failed', amount: 500, purchaseId: null },
    ]);

    harness.stripe.put({ kind: 'invoice', value: invoiceOf(2) });
    expect(
      await harness.reflector.reflect(invoiceInstruction(2, minutesAfterT0(3))),
    ).toEqual({ kind: 'applied' });
    harness.stripe.put({
      kind: 'invoice',
      value: invoiceOf(2, { status: 'uncollectible', amountPaid: 0 }),
    });

    expect(
      await harness.reflector.reflect(invoiceInstruction(2, minutesAfterT0(2))),
    ).toEqual({ kind: 'stale' });
    expect(await readRecords()).toMatchObject([
      { status: 'succeeded', lastEventAt: minutesAfterT0(3) },
    ]);
  });

  test.each(['draft', 'void'] as const)(
    '状態が%sの請求は記録せずに無視する',
    async (status) => {
      const harness = reflectorWith();
      harness.stripe.put({ kind: 'invoice', value: invoiceOf(2, { status }) });

      expect(await harness.reflector.reflect(invoiceInstruction(2))).toEqual({
        kind: 'ignored',
      });
      expect(await readRecords()).toEqual([]);
    },
  );

  test('Stripeに無い請求・定期課金の無い請求・持ち主の分からない請求は、結び付かないとしてIDだけを記録し反映しない', async () => {
    const logs = recordLogs('event');
    const harness = reflectorWith();
    harness.stripe.put({
      kind: 'invoice',
      value: invoiceOf(2, { subscriptionId: null }),
    });
    harness.stripe.put({
      kind: 'invoice',
      value: invoiceOf(3, { subscriptionMetadata: {} }),
    });

    for (const index of [1, 2, 3]) {
      expect(
        await harness.reflector.reflect(invoiceInstruction(index)),
      ).toEqual({ kind: 'unresolved' });
    }

    expect(await readRecords()).toEqual([]);
    const warnings = logs.filter(({ method }) => method === 'warn');
    expect(warnings).toHaveLength(3);
    expect(JSON.stringify(warnings)).not.toContain(PSEUDONYMOUS_ID);
  });

  test('Stripeの一時的な失敗は例外で返し、何も書き込まない', async () => {
    const harness = reflectorWith();
    harness.stripe.put({ kind: 'invoice', value: invoiceOf(2) });
    harness.stripe.failNext(new StripeUnavailableError('Stripeの障害'));

    await expect(
      harness.reflector.reflect(invoiceInstruction(2)),
    ).rejects.toBeInstanceOf(StripeUnavailableError);
    expect(await readRecords()).toEqual([]);
  });
});
