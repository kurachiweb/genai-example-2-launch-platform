import { resetSync } from '@logtape/logtape';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { CHECKOUT_CONSENT_VERSION } from '../../../common-lib/payments/checkout-consent.ts';
import {
  StripeNotFoundError,
  StripeUnavailableError,
} from '../../core/payments/ports.ts';
import type { FulfillablePurchase } from '../../core/payments/purchase-kind-contract.ts';
import {
  AMOUNT_PAID,
  CONSENTED_AT,
  createFakeFulfillment,
  createRecordingSender,
  grantObjectIdOf,
  grantStatementOf,
  harnessWith,
  insertGrant,
  insertPurchase,
  LINK_FUNDING_SOURCE_GROUP,
  NOW,
  OCCURRED_AT,
  paymentIntentIdOf,
  PSEUDONYMOUS_ID,
  readGrants,
  readRefundRows,
  sessionIdOf,
  setStatus,
  snapshotOf,
} from './testing/checkout-reflection-harness.ts';
import { createFakeStripeGateway } from './testing/fake-stripe-gateway.ts';
import { recordLogs } from './testing/fake-stripe.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  purchaseIdOf,
  readPurchaseRow,
  readRecords,
  userIdOf,
} from './testing/payment-store-fixtures.ts';

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

afterAll(() => {
  resetSync();
});

describe('決済セッションの反映の支払いの確定と権利の付与', () => {
  test('支払いが確定した決済は、権利の付与・決済履歴の記録・購入確認メールの依頼待ちが同時に確定し、確定後に依頼と確定後の処理が1回ずつ行われる', async () => {
    await insertPurchase(1);
    const fulfillment = createFakeFulfillment();
    const { reflection, emails, notifierCalls, queue } = harnessWith({
      fulfillment,
    });

    const outcome = await reflection.reflectSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    const records = await readRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      pseudonymousId: PSEUDONYMOUS_ID,
      kind: 'one_time',
      purpose: 'payments_smoke',
      status: 'succeeded',
      amount: AMOUNT_PAID,
      currency: 'usd',
      quantity: 1,
      stripeReference: sessionIdOf(1),
      relatedId: 'related-1',
      purchaseId: purchaseIdOf(1),
      consentedAt: CONSENTED_AT,
      consentVersion: CHECKOUT_CONSENT_VERSION,
      linkFundingSourceGroup: LINK_FUNDING_SOURCE_GROUP,
      occurredAt: OCCURRED_AT,
      lastEventAt: OCCURRED_AT,
      recordedAt: NOW,
    });
    expect((await readGrants()).map(({ objectId }) => objectId)).toEqual([
      grantObjectIdOf(purchaseIdOf(1)),
    ]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
      rejectionReason: null,
      stripePaymentIntentId: paymentIntentIdOf(1),
      stripeInvoiceId: null,
      stripeSubscriptionId: null,
      amountTotal: AMOUNT_PAID,
      paidAt: NOW,
      reflectedAt: NOW,
      lastEventAt: OCCURRED_AT,
      confirmationEmailStatus: 'requested',
    });
    expect(notifierCalls).toEqual([
      { purchaseId: purchaseIdOf(1), statusAtCall: 'fulfilled' },
    ]);
    expect(emails.sent).toHaveLength(1);
    expect(fulfillment.databases).toEqual([db]);
    const expectedPurchase: FulfillablePurchase = {
      purchaseId: purchaseIdOf(1),
      userId: userIdOf(1),
      kind: 'payments_smoke',
      targetId: null,
      relatedId: 'related-1',
      quantity: 1,
      amountTotal: AMOUNT_PAID,
      paymentRecordId: records[0]?.id ?? '',
      paidAt: NOW,
      stripeSubscriptionId: null,
    };
    expect(fulfillment.prepared).toEqual([expectedPurchase]);
    expect(fulfillment.committed).toEqual([expectedPurchase]);
    expect(await readRefundRows()).toEqual([]);
    expect(queue.sent).toEqual([]);
  });

  test('定期課金の決済は初回の請求のIDで定期課金の記録になり、定期課金のIDを購入と権利の付与へ渡す', async () => {
    await insertPurchase(1, { kind: 'ultras' });
    const fulfillment = createFakeFulfillment();
    const { reflection } = harnessWith({ fulfillment });

    const outcome = await reflection.reflectSnapshot(
      snapshotOf(1, {
        invoiceId: 'in_test_reflection_1',
        subscriptionId: 'sub_test_reflection_1',
        metadata: {
          purchase_id: purchaseIdOf(1),
          purchase_kind: 'ultras',
          pseudonymous_id: PSEUDONYMOUS_ID,
        },
      }),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(await readRecords()).toMatchObject([
      {
        kind: 'subscription',
        purpose: 'ultras',
        stripeReference: 'in_test_reflection_1',
        consentVersion: CHECKOUT_CONSENT_VERSION,
      },
    ]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      stripeInvoiceId: 'in_test_reflection_1',
      stripeSubscriptionId: 'sub_test_reflection_1',
    });
    expect(fulfillment.committed).toMatchObject([
      { stripeSubscriptionId: 'sub_test_reflection_1' },
    ]);
  });

  test('同じ決済セッションの2回目の反映は反映済みと現在の状態を返し、記録・付与・依頼を繰り返さない', async () => {
    await insertPurchase(1);
    const fulfillment = createFakeFulfillment();
    const { reflection, emails } = harnessWith({ fulfillment });
    await reflection.reflectSnapshot(snapshotOf(1), OCCURRED_AT);

    const outcome = await reflection.reflectSnapshot(snapshotOf(1), NOW);

    expect(outcome).toEqual({
      kind: 'already_applied',
      purchaseStatus: 'fulfilled',
    });
    expect(await readRecords()).toHaveLength(1);
    expect(await readGrants()).toHaveLength(1);
    expect(emails.sent).toHaveLength(1);
    expect(fulfillment.prepared).toHaveLength(1);
    expect(fulfillment.committed).toHaveLength(1);
  });

  test('return_urlとWebhookから同時に反映しても、記録・権利の付与・購入確認メールの依頼・確定後の処理が1回だけ行われる', async () => {
    await insertPurchase(1);
    const fulfillment = createFakeFulfillment({ barrier: 2 });
    const emails = createRecordingSender();
    const returnUrl = harnessWith({ fulfillment, emails });
    const webhook = harnessWith({ fulfillment, emails });

    const outcomes = await Promise.all([
      returnUrl.reflection.reflectSnapshot(snapshotOf(1), NOW),
      webhook.reflection.reflectSnapshot(snapshotOf(1), OCCURRED_AT),
    ]);

    expect(outcomes).toHaveLength(2);
    expect(outcomes).toContainEqual({
      kind: 'applied',
      purchaseStatus: 'fulfilled',
    });
    expect(outcomes).toContainEqual({
      kind: 'already_applied',
      purchaseStatus: 'fulfilled',
    });
    // 両方が同じ版を読んで権利の付与を準備し、版の検査で一方だけが確定する
    expect(fulfillment.prepared).toHaveLength(2);
    expect(await readRecords()).toHaveLength(1);
    expect(await readGrants()).toHaveLength(1);
    expect(emails.sent).toHaveLength(1);
    expect(fulfillment.committed).toHaveLength(1);
    expect([...returnUrl.notifierCalls, ...webhook.notifierCalls]).toHaveLength(
      1,
    );
  });

  test('置き換え済みの購入でも旧セッションの支払いが確定すれば権利を付与する', async () => {
    await insertPurchase(1);
    await setStatus(1, 'superseded');

    const outcome = await harnessWith().reflection.reflectSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(await readGrants()).toHaveLength(1);
  });

  test('確定後の処理の例外で反映の結果は変わらず、warnのログだけが残る', async () => {
    await insertPurchase(1);
    const fulfillment = createFakeFulfillment({
      afterCommitError: new Error('afterCommit failed'),
    });
    const { reflection, emails } = harnessWith({ fulfillment });
    const logs = recordLogs('event');

    const outcome = await reflection.reflectSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(fulfillment.committed).toHaveLength(1);
    expect(emails.sent).toHaveLength(1);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
    });
    const warnings = logs.filter(({ method }) => method === 'warn');
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).toContain(purchaseIdOf(1));
    expect(logs.filter(({ method }) => method === 'error')).toEqual([]);
  });

  test('確定後の処理を持たない口でも権利を付与する', async () => {
    await insertPurchase(1);
    const fake = createFakeFulfillment();

    const outcome = await harnessWith({
      fulfillment: {
        prepare: (purchase, database) => fake.prepare(purchase, database),
      },
    }).reflection.reflectSnapshot(snapshotOf(1), OCCURRED_AT);

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(await readGrants()).toHaveLength(1);
  });
});

describe('決済セッションの反映の支払いの値の扱い', () => {
  test('支払いの不要な完了は支払いの確定として権利を付与する', async () => {
    await insertPurchase(1);

    const outcome = await harnessWith().reflection.reflectSnapshot(
      snapshotOf(1, { paymentStatus: 'no_payment_required' }),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(await readGrants()).toHaveLength(1);
    expect(await readRecords()).toHaveLength(1);
  });

  test('メタデータに仮名化IDが無ければ例外にし、何も書き込まず口も呼ばない', async () => {
    await insertPurchase(1);
    const fulfillment = createFakeFulfillment();

    await expect(
      harnessWith({ fulfillment }).reflection.reflectSnapshot(
        snapshotOf(1, { metadata: { purchase_id: purchaseIdOf(1) } }),
        OCCURRED_AT,
      ),
    ).rejects.toThrow(sessionIdOf(1));
    expect(fulfillment.prepared).toEqual([]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'open',
    });
    expect(await readRecords()).toEqual([]);
    expect(await readGrants()).toEqual([]);
  });

  test('定期課金の決済セッションに初回の請求が無ければ例外にし、何も書き込まず口も呼ばない', async () => {
    await insertPurchase(1, { kind: 'ultras' });
    const fulfillment = createFakeFulfillment();

    await expect(
      harnessWith({ fulfillment }).reflection.reflectSnapshot(
        snapshotOf(1, { invoiceId: null, subscriptionId: 'sub_test_1' }),
        OCCURRED_AT,
      ),
    ).rejects.toThrow(sessionIdOf(1));
    expect(fulfillment.prepared).toEqual([]);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'open',
    });
    expect(await readRecords()).toEqual([]);
    expect(await readRefundRows()).toEqual([]);
  });
});

describe('決済セッションの反映の権利の付与の文の失敗', () => {
  test('権利の付与の文が失敗すると口を1回だけ呼び直し、呼び直した文が通れば付与する', async () => {
    await insertPurchase(1);
    await insertGrant('grant_conflict');
    const fulfillment = createFakeFulfillment({
      plan: (purchase, attempt) => ({
        kind: 'fulfill',
        statements: [
          attempt === 1
            ? grantStatementOf(purchase, 'grant_conflict')
            : grantStatementOf(purchase),
        ],
      }),
    });

    const outcome = await harnessWith({
      fulfillment,
    }).reflection.reflectSnapshot(snapshotOf(1), OCCURRED_AT);

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(fulfillment.prepared).toHaveLength(2);
    expect(
      new Set(
        fulfillment.prepared.map(({ paymentRecordId }) => paymentRecordId),
      ).size,
    ).toBe(1);
    expect(fulfillment.committed).toHaveLength(1);
    expect(await readRecords()).toHaveLength(1);
    expect(await readRefundRows()).toEqual([]);
  });

  test('呼び直した権利の付与の文も失敗すると、付与できないとして拒否し全額返金を依頼する', async () => {
    await insertPurchase(1);
    await insertGrant(grantObjectIdOf(purchaseIdOf(1)));
    const fulfillment = createFakeFulfillment();
    const { reflection, queue } = harnessWith({ fulfillment });

    const outcome = await reflection.reflectSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'rejected' });
    expect(fulfillment.prepared).toHaveLength(2);
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
});

describe('決済セッションの反映の購入の特定', () => {
  test('決済セッションIDの保存より前に届いた通知は、メタデータの購入IDで購入を探して反映する', async () => {
    await insertPurchase(1, {}, { attachSession: false });

    const outcome = await harnessWith().reflection.reflectSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(await readGrants()).toHaveLength(1);
  });

  test('本サービスの購入に結び付かない決済セッションは反映せず、対象のIDだけをwarnのログに残す', async () => {
    await insertPurchase(2);
    const logs = recordLogs('event');
    const { reflection } = harnessWith();

    const unknownPurchase = await reflection.reflectSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );
    const withoutMetadata = await reflection.reflectSnapshot(
      snapshotOf(1, { metadata: {} }),
      OCCURRED_AT,
    );
    // 別の決済セッションを持つ購入のIDを名乗るメタデータは結び付けない
    const anotherSession = await reflection.reflectSnapshot(
      snapshotOf(1, {
        metadata: {
          purchase_id: purchaseIdOf(2),
          purchase_kind: 'payments_smoke',
          pseudonymous_id: PSEUDONYMOUS_ID,
        },
      }),
      OCCURRED_AT,
    );

    expect([unknownPurchase, withoutMetadata, anotherSession]).toEqual([
      { kind: 'unresolved' },
      { kind: 'unresolved' },
      { kind: 'unresolved' },
    ]);
    expect(await readRecords()).toEqual([]);
    expect(await readPurchaseRow(purchaseIdOf(2))).toMatchObject({
      status: 'open',
    });
    const warnings = logs.filter(({ method }) => method === 'warn');
    expect(warnings).toHaveLength(3);
    expect(JSON.stringify(warnings)).toContain(sessionIdOf(1));
    expect(JSON.stringify(warnings)).not.toContain(PSEUDONYMOUS_ID);
  });
});

describe('決済セッションIDからの反映', () => {
  test('Stripeから決済セッションを取得して反映する', async () => {
    await insertPurchase(1);
    const gateway = createFakeStripeGateway({
      retrieveCheckoutSession: () => Promise.resolve(snapshotOf(1)),
    });

    const outcome = await harnessWith({ gateway }).reflection.reflectSession(
      sessionIdOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(gateway.callsOf('retrieveCheckoutSession')).toEqual([
      { method: 'retrieveCheckoutSession', args: [sessionIdOf(1)] },
    ]);
    expect(await readRecords()).toMatchObject([{ occurredAt: OCCURRED_AT }]);
  });

  test('Stripeに無い決済セッションは結び付かないとして反映しない', async () => {
    const gateway = createFakeStripeGateway({
      retrieveCheckoutSession: () =>
        Promise.reject(new StripeNotFoundError('No such checkout session')),
    });
    const logs = recordLogs('event');

    expect(
      await harnessWith({ gateway }).reflection.reflectSession(
        sessionIdOf(1),
        OCCURRED_AT,
      ),
    ).toEqual({ kind: 'unresolved' });
    expect(logs.filter(({ method }) => method === 'warn')).toHaveLength(1);
  });

  test('Stripeの一時的な失敗は例外として返し、何も書き込まない', async () => {
    await insertPurchase(1);
    const gateway = createFakeStripeGateway({
      retrieveCheckoutSession: () =>
        Promise.reject(new StripeUnavailableError('Stripe unavailable')),
    });

    await expect(
      harnessWith({ gateway }).reflection.reflectSession(
        sessionIdOf(1),
        OCCURRED_AT,
      ),
    ).rejects.toBeInstanceOf(StripeUnavailableError);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'open',
    });
    expect(await readRecords()).toEqual([]);
  });
});
