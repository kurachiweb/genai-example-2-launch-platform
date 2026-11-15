import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import { PAYMENTS_TYPES } from '../../core/payments/identifiers.ts';
import type {
  PaymentReflector,
  PaymentRevenueReport,
} from '../../core/payments/ports.ts';
import type {
  PaymentsEnv,
  PurchaseKindRegistry,
  PurchaseOfferPolicy,
} from '../../core/payments/purchase-kind-contract.ts';
import { EMAIL_PLATFORM_MODULE } from '../email/email-platform-module.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { IDENTITY_PLATFORM_MODULE } from '../identity/identity-platform-module.ts';
import {
  ULTRAS_PURCHASE_KIND_REGISTRATION,
  ULTRAS_SUBSCRIPTION_EVENT_SINK_REGISTRATION,
} from '../ultras/ultras-registrations.ts';
import { StripeCheckoutSessionReflection } from './checkout-session-reflection.ts';
import { D1CustomerStore } from './d1-customer-store.ts';
import { D1PaymentRecordStore } from './d1-payment-record-store.ts';
import { D1PaymentRevenueReport } from './d1-payment-revenue-report.ts';
import { D1PriceSnapshotStore } from './d1-price-snapshot-store.ts';
import { D1PurchaseStore } from './d1-purchase-store.ts';
import { D1RefundStore } from './d1-refund-store.ts';
import { D1StripeObjectStore } from './d1-stripe-object-store.ts';
import type {
  PurchaseFulfillment,
  PurchaseKindRegistration,
} from './fulfillment-contract.ts';
import { D1GuardedBatch } from './guarded-batch.ts';
import { StripeOpenCheckoutExpirer } from './open-checkout-expirer.ts';
import { StripePaymentOwnerResolver } from './payment-owner-resolver.ts';
import { StripePaymentReflector } from './payment-reflector.ts';
import { D1PaymentRefunds } from './payment-refunds.ts';
import { createPaymentsPlatformModule } from './payments-platform-module.ts';
import { StripePriceCatalog } from './price-catalog.ts';
import {
  PURCHASE_KIND_REGISTRATIONS,
  SUBSCRIPTION_EVENT_SINKS,
} from './purchase-kind-registrations.ts';
import { EmailPurchaseNotifier } from './purchase-notifier.ts';
import { StoredPaymentHistoryExport } from './payment-history-export.ts';
import {
  SMOKE_PURCHASE_LOOKUP_KEY,
  SMOKE_PURCHASE_REGISTRATION,
} from './smoke-purchase.ts';
import { StripeApiGateway } from './stripe-gateway.ts';
import {
  insertPurchase,
  OCCURRED_AT,
  readRefundRows,
  snapshotOf,
} from './testing/checkout-reflection-harness.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  purchaseIdOf,
  readPurchaseRow,
  readRecords,
  userIdOf,
} from './testing/payment-store-fixtures.ts';

const PAYMENTS_PLATFORM_MODULE = createPaymentsPlatformModule('api');

const SMOKE_ENABLED_ENV: PaymentsEnv = {
  PAYMENTS_SMOKE_ENABLED: 'true',
  CLIENT_SITE_ORIGIN: 'https://client.example',
};

const SMOKE_DISABLED_ENV: PaymentsEnv = {
  ...SMOKE_ENABLED_ENV,
  PAYMENTS_SMOKE_ENABLED: 'false',
};

function createContainer(
  smokeEnabled: PaymentsEnv['PAYMENTS_SMOKE_ENABLED'] = 'true',
): Container {
  return createInvocationContainer(
    {
      env: { ...env, PAYMENTS_SMOKE_ENABLED: smokeEnabled },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-payments-platform',
        clientIp: undefined,
      },
    },
    [EMAIL_PLATFORM_MODULE, IDENTITY_PLATFORM_MODULE, PAYMENTS_PLATFORM_MODULE],
  );
}

function registryOf(
  container: Container,
): PurchaseKindRegistry<PurchaseKindRegistration> {
  return container.get<PurchaseKindRegistry<PurchaseKindRegistration>>(
    PAYMENTS_TYPES.PurchaseKindRegistry,
  );
}

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

afterAll(() => {
  resetSync();
});

describe('createPaymentsPlatformModule', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      PAYMENTS_PLATFORM_MODULE,
      createPaymentsPlatformModule('event'),
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(PAYMENTS_PLATFORM_MODULE.name).toBe('payments-platform');
    expect('routes' in PAYMENTS_PLATFORM_MODULE).toBe(false);
  });

  test('処理単位のコンテナから反映・返金・失効・価格・エクスポート・純収益の照会・Customerの照会・通知・Stripeのゲートウェイを解決する', () => {
    const container = createContainer();

    expect(container.get(PAYMENTS_TYPES.PaymentReflector)).toBeInstanceOf(
      StripePaymentReflector,
    );
    expect(
      container.get(PAYMENTS_TYPES.CheckoutSessionReflection),
    ).toBeInstanceOf(StripeCheckoutSessionReflection);
    expect(container.get(PAYMENTS_TYPES.PaymentRefunds)).toBeInstanceOf(
      D1PaymentRefunds,
    );
    expect(container.get(PAYMENTS_TYPES.OpenCheckoutExpirer)).toBeInstanceOf(
      StripeOpenCheckoutExpirer,
    );
    expect(container.get(PAYMENTS_TYPES.PriceCatalog)).toBeInstanceOf(
      StripePriceCatalog,
    );
    expect(container.get(PAYMENTS_TYPES.PaymentHistoryExport)).toBeInstanceOf(
      StoredPaymentHistoryExport,
    );
    expect(container.get(PAYMENTS_TYPES.PaymentRevenueReport)).toBeInstanceOf(
      D1PaymentRevenueReport,
    );
    expect(container.get(PAYMENTS_TYPES.CustomerDirectory)).toBeInstanceOf(
      D1CustomerStore,
    );
    expect(container.get(PAYMENTS_TYPES.PurchaseNotifier)).toBeInstanceOf(
      EmailPurchaseNotifier,
    );
    expect(container.get(PAYMENTS_TYPES.StripeGateway)).toBeInstanceOf(
      StripeApiGateway,
    );
    expect(container.get(PAYMENTS_TYPES.PaymentOwnerResolver)).toBeInstanceOf(
      StripePaymentOwnerResolver,
    );
    expect(container.get(PAYMENTS_TYPES.GuardedBatch)).toBeInstanceOf(
      D1GuardedBatch,
    );
    expect(container.get(PAYMENTS_TYPES.PriceSnapshotStore)).toBeInstanceOf(
      D1PriceSnapshotStore,
    );
  });

  test.each([
    ['PurchaseStore', 'PurchaseStatements', D1PurchaseStore],
    ['PaymentRecordStore', 'PaymentRecordStatements', D1PaymentRecordStore],
    ['RefundStore', 'RefundStatements', D1RefundStore],
    ['CustomerStore', 'CustomerStatements', D1CustomerStore],
    ['StripeObjectStore', 'StripeObjectStatements', D1StripeObjectStore],
    ['PaymentRefunds', 'PaymentRefundStatements', D1PaymentRefunds],
  ] as const)(
    '文を返さない操作の%sと文を返す操作の%sは同じインスタンスに解決される',
    (operations, statements, implementation) => {
      const container = createContainer();

      const resolved = container.get(PAYMENTS_TYPES[operations]);

      expect(resolved).toBeInstanceOf(implementation);
      expect(container.get(PAYMENTS_TYPES[statements])).toBe(resolved);
    },
  );

  test('Customerの照会はCustomerのストアと同じインスタンスに解決される', () => {
    const container = createContainer();

    expect(container.get(PAYMENTS_TYPES.CustomerDirectory)).toBe(
      container.get(PAYMENTS_TYPES.CustomerStore),
    );
  });

  test('1つの処理単位では同じインスタンスを使い回し、処理単位をまたいで共有しない', () => {
    const first = createContainer();
    const second = createContainer();

    expect(first.get(PAYMENTS_TYPES.PaymentReflector)).toBe(
      first.get(PAYMENTS_TYPES.PaymentReflector),
    );
    expect(first.get(PAYMENTS_TYPES.StripeGateway)).toBe(
      first.get(PAYMENTS_TYPES.StripeGateway),
    );
    expect(first.get(PAYMENTS_TYPES.PaymentReflector)).not.toBe(
      second.get(PAYMENTS_TYPES.PaymentReflector),
    );
  });

  test('Webhookの署名の検証はイベントサーバーのモジュールが束縛するため、共通の束縛に含めない', () => {
    const container = createContainer();

    expect(container.isBound(PAYMENTS_TYPES.StripeWebhookVerifier)).toBe(false);
  });

  test('純収益の照会を取り出して処理単位のD1で集計できる', async () => {
    const container = createContainer();

    const totals = await container
      .get<PaymentRevenueReport>(PAYMENTS_TYPES.PaymentRevenueReport)
      .netRevenue([
        {
          from: new Date('2026-11-01T00:00:00.000Z'),
          to: new Date('2026-11-08T00:00:00.000Z'),
        },
      ]);

    expect(totals).toEqual([0]);
  });
});

describe('購入種別の登録', () => {
  test('登録箇所は疎通確認用とUltrasの購入種別をこの順に登録し、定期課金の受け取り口はUltrasの加入状態の受け取り口だけを持つ', () => {
    expect(PURCHASE_KIND_REGISTRATIONS).toEqual([
      SMOKE_PURCHASE_REGISTRATION,
      ULTRAS_PURCHASE_KIND_REGISTRATION,
    ]);
    expect(SUBSCRIPTION_EVENT_SINKS).toEqual([
      ULTRAS_SUBSCRIPTION_EVENT_SINK_REGISTRATION,
    ]);
    expect(Object.isFrozen(PURCHASE_KIND_REGISTRATIONS)).toBe(true);
    expect(Object.isFrozen(SUBSCRIPTION_EVENT_SINKS)).toBe(true);
  });

  test('購入種別の登録の解決は登録箇所の値から作った1つの値で、処理単位をまたいで同じ値を返す', () => {
    const first = registryOf(createContainer());
    const second = registryOf(createContainer());

    expect(first).toBe(second);
    expect(first.resolve('payments_smoke', SMOKE_ENABLED_ENV)).toBe(
      SMOKE_PURCHASE_REGISTRATION,
    );
  });

  test('登録していない購入種別は解決されず、Ultrasは疎通確認の有効の条件によらず解決される', () => {
    const registry = registryOf(createContainer());

    expect(
      registry.resolve('week_tournament_entry', SMOKE_ENABLED_ENV),
    ).toBeUndefined();
    expect(registry.resolve('ultras', SMOKE_ENABLED_ENV)).toBe(
      ULTRAS_PURCHASE_KIND_REGISTRATION,
    );
    expect(registry.resolve('ultras', SMOKE_DISABLED_ENV)).toBe(
      ULTRAS_PURCHASE_KIND_REGISTRATION,
    );
  });

  test('PAYMENTS_SMOKE_ENABLEDがfalseの環境では疎通確認用の購入種別が解決されない', () => {
    const registry = registryOf(createContainer('false'));

    expect(
      registry.resolve('payments_smoke', SMOKE_DISABLED_ENV),
    ).toBeUndefined();
  });
});

describe('疎通確認用の購入種別', () => {
  test('購入の内容は1USDの価格・数量1・期限無し・二重決済の判定無し・bot判定無し', async () => {
    const container = createContainer();
    const registration = registryOf(container).resolve(
      'payments_smoke',
      SMOKE_ENABLED_ENV,
    );
    if (registration === undefined) {
      throw new Error('疎通確認用の購入種別が解決されませんでした');
    }

    const decision = await container
      .get<PurchaseOfferPolicy>(registration.offer)
      .describe({
        userId: userIdOf(1),
        targetId: null,
        now: new Date('2026-11-05T00:00:00.000Z'),
      });

    expect(SMOKE_PURCHASE_LOOKUP_KEY).toBe('payments_smoke');
    expect(decision).toEqual({
      kind: 'available',
      offer: {
        priceLookupKey: 'payments_smoke',
        quantity: 1,
        relatedId: null,
        exclusivityKey: null,
        deadlineAt: null,
        acceptUntil: null,
        fulfillableUntil: null,
        summary: {
          itemName: '決済の疎通確認',
          quantityLabel: '1件',
          serviceTiming: '提供する役務はありません',
          additionalNotes: [
            '決済の疎通確認のための購入です。開発と検証の環境だけで受け付け、権利は付与されません。',
          ],
        },
        requiresBotVerification: false,
      },
    });
  });

  test('権利の付与は文を返さずに付与として扱い、確定後の処理を持たない', async () => {
    const container = createContainer();
    const fulfillment = container.get<PurchaseFulfillment>(
      PAYMENTS_TYPES.SmokePurchaseFulfillment,
    );

    const plan = await fulfillment.prepare(
      {
        purchaseId: purchaseIdOf(1),
        userId: userIdOf(1),
        kind: 'payments_smoke',
        targetId: null,
        relatedId: null,
        quantity: 1,
        amountTotal: 100,
        paymentRecordId: '01JC0RECORD000000000000001',
        paidAt: new Date('2026-11-05T00:00:00.000Z'),
        stripeSubscriptionId: null,
      },
      db,
    );

    expect(plan).toEqual({ kind: 'fulfill', statements: [] });
    expect('afterCommit' in fulfillment).toBe(false);
  });

  test('共通の束縛から取り出した反映は、疎通確認の決済を権利の付与無しで完了させ決済履歴に記録する', async () => {
    await insertPurchase(1, { relatedId: null });
    const reflector = createContainer().get<PaymentReflector>(
      PAYMENTS_TYPES.PaymentReflector,
    );

    const outcome = await reflector.reflectCheckoutSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'fulfilled' });
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
    });
    expect(await readRecords()).toEqual([
      expect.objectContaining({
        purpose: 'payments_smoke',
        kind: 'one_time',
        status: 'succeeded',
      }),
    ]);
    expect(await readRefundRows()).toEqual([]);
  });

  test('PAYMENTS_SMOKE_ENABLEDがfalseの環境の反映は、疎通確認の決済を権利を付与できない購入として拒否し返金を依頼する', async () => {
    await insertPurchase(1, { relatedId: null });
    const reflector = createContainer('false').get<PaymentReflector>(
      PAYMENTS_TYPES.PaymentReflector,
    );

    const outcome = await reflector.reflectCheckoutSnapshot(
      snapshotOf(1),
      OCCURRED_AT,
    );

    expect(outcome).toEqual({ kind: 'applied', purchaseStatus: 'rejected' });
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'rejected',
      rejectionReason: 'ineligible',
    });
    expect(await readRefundRows()).toHaveLength(1);
  });
});
