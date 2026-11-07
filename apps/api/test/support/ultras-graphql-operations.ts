import { resetSync } from '@logtape/logtape';
import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { ULTRAS_PRICE_LOOKUP_KEY } from '../../common-lib/ultras/plan-status.ts';
import { ULTRAS_PROMOTION_FLAG_KEY } from '../../common-lib/ultras/promotion-flag.ts';
import { ultrasActivations } from '../../db/schema/ultras/ultras-activations.ts';
import { ultrasNotices } from '../../db/schema/ultras/ultras-notices.ts';
import { ultrasSettings } from '../../db/schema/ultras/ultras-settings.ts';
import { ultrasSubscriptions } from '../../db/schema/ultras/ultras-subscriptions.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type {
  StripeGateway,
  StripePrice,
} from '../../lib/core/payments/ports.ts';
import { D1CustomerStore } from '../../lib/workers/payments/d1-customer-store.ts';
import { D1PriceSnapshotStore } from '../../lib/workers/payments/d1-price-snapshot-store.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from '../../lib/workers/payments/testing/fake-stripe-gateway.ts';
import { clearPaymentTables } from '../../lib/workers/payments/testing/payment-store-fixtures.ts';
import {
  db,
  restoreUltrasSettingsSeed,
  userIdOf,
} from '../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import { paymentsSchemaModule } from '../../src/presentation/graphql/modules/payments/index.ts';
import { ultrasSchemaModule } from '../../src/presentation/graphql/modules/ultras/index.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
} from './graphql-gateway.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from './observability-recording.ts';
import {
  customerIdOf,
  type StartedSessions,
  startHandlers,
} from './payments-graphql-operations.ts';

export {
  codesOf,
  customerIdOf,
  insertUser,
  insertVerifiedUser,
  issueUserSession,
  readPurchase,
  type StartedSessions,
  suspendUser,
  userIdOf,
} from './payments-graphql-operations.ts';

export interface MoneyFields {
  readonly amount: number;
  readonly currency: string;
}

export interface UltrasOfferFields {
  readonly promotionEnabled: boolean;
  readonly price: MoneyFields | null;
  readonly priceStale: boolean;
}

export interface UltrasPlanFields {
  readonly status: string;
  readonly startedAt: string;
  readonly currentPeriodEndsAt: string | null;
  readonly benefitEndsAt: string | null;
  readonly canceledAt: string | null;
}

export interface ViewerUltrasFields {
  readonly plan: UltrasPlanFields | null;
  readonly entitled: boolean;
  readonly canOpenPortal: boolean;
}

export const ULTRAS_OFFER = /* GraphQL */ `
  query ClientUltrasOffer {
    ultrasOffer {
      promotionEnabled
      price {
        amount
        currency
      }
      priceStale
    }
  }
`;

export const VIEWER_ULTRAS = /* GraphQL */ `
  query ClientViewerUltras {
    viewerUltras {
      plan {
        status
        startedAt
        currentPeriodEndsAt
        benefitEndsAt
        canceledAt
      }
      entitled
      canOpenPortal
    }
  }
`;

export const START_ULTRAS_CHECKOUT = /* GraphQL */ `
  mutation ClientStartUltrasCheckout {
    startUltrasCheckout {
      purchaseId
    }
  }
`;

export const CREATE_ULTRAS_PORTAL_SESSION = /* GraphQL */ `
  mutation ClientCreateUltrasPortalSession {
    createUltrasPortalSession {
      url
    }
  }
`;

export const ULTRAS_PRICE: StripePrice = Object.freeze({
  lookupKey: ULTRAS_PRICE_LOOKUP_KEY,
  priceId: 'price_ultras_monthly',
  unitAmount: 999,
  currency: 'usd',
  recurringInterval: 'month',
});

let stripe: FakeStripeGateway = createFakeStripeGateway();

// Stripeへ通信しないよう、各テストが渡した応答だけを返す偽のゲートウェイに差し替える
const overridesModule: AppModule<GatewayApp> = {
  name: 'ultras-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toDynamicValue(
      () => stripe,
    );
  }),
};

// Ultrasの型定義はpaymentsのMoneyとCheckoutStartを参照するため、paymentsのスキーマモジュールと合わせて載せる
export const ultrasGateway = createGraphQLGateway({
  documents: [
    ULTRAS_OFFER,
    VIEWER_ULTRAS,
    START_ULTRAS_CHECKOUT,
    CREATE_ULTRAS_PORTAL_SESSION,
  ],
  schemaModules: [paymentsSchemaModule, ultrasSchemaModule],
  overrides: [overridesModule],
});

export function useStripe(handlers: Partial<StripeGateway>): FakeStripeGateway {
  stripe = createFakeStripeGateway(handlers);
  return stripe;
}

// 決済の開始に要るStripeの操作に成功の応答を返し、価格の照会にはUltrasの月額の価格を返す
export function ultrasStartHandlers(
  sessions: StartedSessions = { sessionIds: [], inputs: [] },
): Partial<StripeGateway> {
  return {
    ...startHandlers(sessions),
    resolvePrices: () => Promise.resolve([ULTRAS_PRICE]),
  };
}

export interface UltrasTestContext {
  readonly logs: () => readonly LoggedObject[];
}

// 各テストの前にUltras・決済・利用者のテーブルと機能フラグの初期行、ログの記録、差し替えを戻す。
// ultrasとpaymentsの表はどちらも利用者を参照するため、ultrasの行を先に消してから決済の行と利用者を消す
export function installUltrasGraphQLTest(): UltrasTestContext {
  let logs: LoggedObject[] = [];

  beforeAll(() => {
    logs = configureRecordingLogs();
  });

  beforeEach(async () => {
    await db.batch([
      db.delete(ultrasNotices),
      db.delete(ultrasActivations),
      db.delete(ultrasSubscriptions),
    ]);
    await clearPaymentTables();
    await restoreUltrasSettingsSeed();
    stripe = createFakeStripeGateway();
    logs.splice(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    resetSync();
  });

  return { logs: () => logs };
}

export async function enableUltrasPromotion(): Promise<void> {
  await db
    .update(ultrasSettings)
    .set({ enabled: true, version: 1, updatedAt: new Date() })
    .where(eq(ultrasSettings.settingKey, ULTRAS_PROMOTION_FLAG_KEY));
}

// Stripeに到達できないときの縮退を再現するため、照会済みの価格をその取得日時で保存する
export async function savePriceSnapshot(
  price: StripePrice,
  fetchedAt: Date,
): Promise<void> {
  await new D1PriceSnapshotStore(db).saveMany([price], fetchedAt);
}

// 決済の開始で作られたStripeのCustomerとの結び付きを再現する
export async function saveCustomer(
  userIndex: number,
  customerId: string = customerIdOf(userIndex),
): Promise<void> {
  await new D1CustomerStore(db).save(userIdOf(userIndex), customerId);
}

export function fetchUltrasOffer(options?: GatewayCallOptions) {
  return ultrasGateway.call<{ ultrasOffer: UltrasOfferFields | null }>(
    ULTRAS_OFFER,
    {},
    options,
  );
}

export function fetchViewerUltras(options?: GatewayCallOptions) {
  return ultrasGateway.call<{ viewerUltras: ViewerUltrasFields | null }>(
    VIEWER_ULTRAS,
    {},
    options,
  );
}

export function startUltrasCheckout(options?: GatewayCallOptions) {
  return ultrasGateway.call<{
    startUltrasCheckout: { purchaseId: string } | null;
  }>(START_ULTRAS_CHECKOUT, {}, options);
}

export function createUltrasPortalSession(options?: GatewayCallOptions) {
  return ultrasGateway.call<{
    createUltrasPortalSession: { url: string } | null;
  }>(CREATE_ULTRAS_PORTAL_SESSION, {}, options);
}
