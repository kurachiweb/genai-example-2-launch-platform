import { resetSync } from '@logtape/logtape';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import {
  StripeNotFoundError,
  StripeUnavailableError,
  type StripePaymentOwnerHint,
} from '../../core/payments/ports.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import { StripePaymentOwnerResolver } from './payment-owner-resolver.ts';
import { recordLogs } from './testing/fake-stripe.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from './testing/fake-stripe-gateway.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  newPurchase,
  purchaseIdOf,
  tokenOf,
  userIdOf,
} from './testing/payment-store-fixtures.ts';

const PSEUDONYMOUS_ID = 'psn_01JC0OWNER0000000000000001';
const PAYMENT_INTENT_ID = 'pi_test_owner_1';

const purchases = new D1PurchaseStore(db);

function hintOf(
  overrides: Partial<StripePaymentOwnerHint> = {},
): StripePaymentOwnerHint {
  return {
    paymentIntentId: PAYMENT_INTENT_ID,
    metadata: {},
    subscriptionMetadata: null,
    ...overrides,
  };
}

function metadataOf(
  purchaseId: string,
  purchaseKind = 'payments_smoke',
): Readonly<Record<string, string>> {
  return {
    purchase_id: purchaseId,
    purchase_kind: purchaseKind,
    pseudonymous_id: PSEUDONYMOUS_ID,
  };
}

function resolverWith(gateway: FakeStripeGateway): StripePaymentOwnerResolver {
  return new StripePaymentOwnerResolver({
    appName: 'event',
    gateway,
    purchases,
  });
}

async function insertPurchase(
  index: number,
  kind: 'payments_smoke' | 'ultras' = 'payments_smoke',
  paymentIntentId: string | null = null,
): Promise<void> {
  await db.batch([purchases.create(newPurchase(index, { kind }))]);
  if (paymentIntentId !== null) {
    await db.batch([
      purchases.advance({
        purchaseId: purchaseIdOf(index),
        to: 'fulfilled',
        from: ['open'],
        nextToken: tokenOf(index + 1000),
        patch: { stripePaymentIntentId: paymentIntentId },
      }),
    ]);
  }
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

afterAll(() => {
  resetSync();
});

describe('StripePaymentOwnerResolverの特定', () => {
  test('PaymentIntentのIDが購入に結び付けば、購入の行と、メタデータの仮名化IDを返す', async () => {
    await insertPurchase(1, 'payments_smoke', PAYMENT_INTENT_ID);
    const gateway = createFakeStripeGateway({
      retrievePaymentIntentOwner: () =>
        Promise.resolve(hintOf({ metadata: metadataOf(purchaseIdOf(1)) })),
    });

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'refund',
      objectId: 're_test_1',
      paymentIntentId: PAYMENT_INTENT_ID,
    });

    expect(resolution).toMatchObject({
      kind: 'resolved',
      pseudonymousId: PSEUDONYMOUS_ID,
      purchaseKind: 'payments_smoke',
      purchaseId: purchaseIdOf(1),
      purchase: {
        id: purchaseIdOf(1),
        userId: userIdOf(1),
        stripePaymentIntentId: PAYMENT_INTENT_ID,
      },
    });
    expect(gateway.callsOf('retrievePaymentIntentOwner')).toEqual([
      { method: 'retrievePaymentIntentOwner', args: [PAYMENT_INTENT_ID] },
    ]);
  });

  test('購入の行が無ければ(物理削除の後)、PaymentIntentのメタデータから仮名化ID・購入ID・購入種別を返す', async () => {
    const gateway = createFakeStripeGateway({
      retrievePaymentIntentOwner: () =>
        Promise.resolve(hintOf({ metadata: metadataOf(purchaseIdOf(9)) })),
    });

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'dispute',
      objectId: 'dp_test_1',
      paymentIntentId: PAYMENT_INTENT_ID,
    });

    expect(resolution).toEqual({
      kind: 'resolved',
      pseudonymousId: PSEUDONYMOUS_ID,
      purchaseKind: 'payments_smoke',
      purchaseId: purchaseIdOf(9),
      purchase: null,
    });
  });

  test('PaymentIntentのIDがまだ保存されていない購入も、メタデータの購入IDで購入の行を返す', async () => {
    await insertPurchase(1);
    const gateway = createFakeStripeGateway({
      retrievePaymentIntentOwner: () =>
        Promise.resolve(hintOf({ metadata: metadataOf(purchaseIdOf(1)) })),
    });

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'refund',
      objectId: 're_test_1',
      paymentIntentId: PAYMENT_INTENT_ID,
    });

    expect(resolution).toMatchObject({
      kind: 'resolved',
      purchaseId: purchaseIdOf(1),
      purchase: { id: purchaseIdOf(1), stripePaymentIntentId: null },
    });
  });

  test('PaymentIntentのメタデータが無い請求の支払いは、定期課金のメタデータから特定し、購入の行を返す', async () => {
    await insertPurchase(1, 'ultras');
    const gateway = createFakeStripeGateway({
      retrievePaymentIntentOwner: () =>
        Promise.resolve(
          hintOf({
            subscriptionMetadata: metadataOf(purchaseIdOf(1), 'ultras'),
          }),
        ),
    });

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'invoice',
      objectId: 'in_test_1',
      paymentIntentId: PAYMENT_INTENT_ID,
      subscriptionMetadata: {},
    });

    expect(resolution).toMatchObject({
      kind: 'resolved',
      pseudonymousId: PSEUDONYMOUS_ID,
      purchaseKind: 'ultras',
      purchaseId: purchaseIdOf(1),
      purchase: { id: purchaseIdOf(1), kind: 'ultras' },
    });
  });

  test('PaymentIntentの無い請求は、Stripeを呼ばずに請求の定期課金のメタデータから特定する', async () => {
    const gateway = createFakeStripeGateway();

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'invoice',
      objectId: 'in_test_1',
      paymentIntentId: null,
      subscriptionMetadata: metadataOf(purchaseIdOf(9), 'ultras'),
    });

    expect(resolution).toEqual({
      kind: 'resolved',
      pseudonymousId: PSEUDONYMOUS_ID,
      purchaseKind: 'ultras',
      purchaseId: purchaseIdOf(9),
      purchase: null,
    });
    expect(gateway.calls).toEqual([]);
  });

  test('購入の行があれば、メタデータの購入種別より購入の行の購入種別を使う', async () => {
    await insertPurchase(1, 'payments_smoke', PAYMENT_INTENT_ID);
    const gateway = createFakeStripeGateway({
      retrievePaymentIntentOwner: () =>
        Promise.resolve(
          hintOf({ metadata: metadataOf(purchaseIdOf(1), 'unknown_kind') }),
        ),
    });

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'refund',
      objectId: 're_test_1',
      paymentIntentId: PAYMENT_INTENT_ID,
    });

    expect(resolution).toMatchObject({
      kind: 'resolved',
      purchaseKind: 'payments_smoke',
    });
  });
});

describe('StripePaymentOwnerResolverの結び付かない通知', () => {
  test('どのメタデータにも仮名化IDが無ければ、対象のIDだけをwarnのログに残してunresolvedを返す', async () => {
    const logs = recordLogs('event');
    const gateway = createFakeStripeGateway({
      retrievePaymentIntentOwner: () =>
        Promise.resolve(
          hintOf({
            metadata: { purchase_id: purchaseIdOf(9) },
            subscriptionMetadata: { note: 'ダッシュボードで作成' },
          }),
        ),
    });

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'refund',
      objectId: 're_test_1',
      paymentIntentId: PAYMENT_INTENT_ID,
    });

    expect(resolution).toEqual({ kind: 'unresolved' });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.method).toBe('warn');
    const entry = logs[0]?.args[0];
    expect(entry).toMatchObject({
      level: 'warning',
      category: 'event.payments.owner',
      objectType: 'refund',
      objectId: 're_test_1',
      paymentIntentId: PAYMENT_INTENT_ID,
    });
    expect(Object.keys(entry as Record<string, unknown>).sort()).toEqual([
      'category',
      'level',
      'message',
      'objectId',
      'objectType',
      'paymentIntentId',
      'time',
    ]);
    expect(JSON.stringify(logs)).not.toContain(PSEUDONYMOUS_ID);
  });

  test('購入の行があっても仮名化IDが分からなければunresolvedを返し、ログに利用者と購入を出さない', async () => {
    await insertPurchase(1, 'payments_smoke', PAYMENT_INTENT_ID);
    const logs = recordLogs('event');
    const gateway = createFakeStripeGateway({
      retrievePaymentIntentOwner: () => Promise.resolve(hintOf()),
    });

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'dispute',
      objectId: 'dp_test_1',
      paymentIntentId: PAYMENT_INTENT_ID,
    });

    expect(resolution).toEqual({ kind: 'unresolved' });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(userIdOf(1));
    expect(JSON.stringify(logs)).not.toContain(purchaseIdOf(1));
  });

  test('購入の行が無く、メタデータの購入種別が未知ならunresolvedを返す', async () => {
    const logs = recordLogs('event');
    const gateway = createFakeStripeGateway({
      retrievePaymentIntentOwner: () =>
        Promise.resolve(
          hintOf({ metadata: metadataOf(purchaseIdOf(9), 'unknown_kind') }),
        ),
    });

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'refund',
      objectId: 're_test_1',
      paymentIntentId: PAYMENT_INTENT_ID,
    });

    expect(resolution).toEqual({ kind: 'unresolved' });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(PSEUDONYMOUS_ID);
  });

  test('PaymentIntentもメタデータも無ければ、Stripeを呼ばずにunresolvedを返す', async () => {
    const logs = recordLogs('event');
    const gateway = createFakeStripeGateway();

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'refund',
      objectId: 're_test_1',
      paymentIntentId: null,
    });

    expect(resolution).toEqual({ kind: 'unresolved' });
    expect(gateway.calls).toEqual([]);
    expect(logs[0]?.args[0]).toMatchObject({
      objectType: 'refund',
      objectId: 're_test_1',
      paymentIntentId: null,
    });
  });

  test('StripeにPaymentIntentが無ければ、請求の定期課金のメタデータで特定を続ける', async () => {
    const gateway = createFakeStripeGateway({
      retrievePaymentIntentOwner: () =>
        Promise.reject(new StripeNotFoundError('存在しません')),
    });

    const resolution = await resolverWith(gateway).resolve({
      objectType: 'invoice',
      objectId: 'in_test_1',
      paymentIntentId: PAYMENT_INTENT_ID,
      subscriptionMetadata: metadataOf(purchaseIdOf(9), 'ultras'),
    });

    expect(resolution).toMatchObject({
      kind: 'resolved',
      pseudonymousId: PSEUDONYMOUS_ID,
      purchaseKind: 'ultras',
    });
  });

  test('Stripeの一時的な失敗は例外のまま返す', async () => {
    const failure = new StripeUnavailableError('一時的な失敗');
    const gateway = createFakeStripeGateway({
      retrievePaymentIntentOwner: () => Promise.reject(failure),
    });

    await expect(
      resolverWith(gateway).resolve({
        objectType: 'refund',
        objectId: 're_test_1',
        paymentIntentId: PAYMENT_INTENT_ID,
      }),
    ).rejects.toBe(failure);
  });
});
