import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import { paymentCustomers } from '../../db/schema/payments/payment-customers.ts';
import { paymentPriceSnapshots } from '../../db/schema/payments/payment-price-snapshots.ts';
import { paymentPurchases } from '../../db/schema/payments/payment-purchases.ts';
import { paymentRecords } from '../../db/schema/payments/payment-records.ts';
import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import { paymentStripeObjects } from '../../db/schema/payments/payment-stripe-objects.ts';
import { ultrasActivations } from '../../db/schema/ultras/ultras-activations.ts';
import { ultrasNotices } from '../../db/schema/ultras/ultras-notices.ts';
import { ultrasSubscriptions } from '../../db/schema/ultras/ultras-subscriptions.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type {
  StripeGateway,
  StripePrice,
} from '../../lib/core/payments/ports.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { WEEK_ENTRY_PRICE_LOOKUP_KEY } from '../../lib/core/week-tournament/week-schedule.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from '../../lib/workers/payments/testing/fake-stripe-gateway.ts';
import {
  db,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import {
  clearWeekTournamentRows,
  clearWeekTournamentTables,
} from '../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { matchSchemaModule } from '../../src/presentation/graphql/modules/match/index.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { paymentsSchemaModule } from '../../src/presentation/graphql/modules/payments/index.ts';
import { productSchemaModule } from '../../src/presentation/graphql/modules/product/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import { weekTournamentSchemaModule } from '../../src/presentation/graphql/modules/week-tournament/index.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
} from './graphql-gateway.ts';
import {
  type StartedSessions,
  startHandlers,
} from './payments-graphql-operations.ts';

export {
  codesOf,
  readPurchase,
  type StartedSessions,
} from './payments-graphql-operations.ts';

// 2026-11-16の週の枠の、勝利の確定(2026-11-21)の後で受付期限(2026-11-23 23:00)より前の時刻
export const WEEK_ENTRY_TEST_NOW = fromBusinessDateTime(
  parseBusinessDate('2026-11-22'),
  { hour: 12, minute: 0 },
);

export interface WeekEntryProgressFields {
  readonly alive: boolean;
  readonly eliminatedRoundName: string | null;
  readonly champion: boolean;
}

export interface WeekEntryPanelFields {
  readonly launchId: string;
  readonly week: string;
  readonly weekLabel: string;
  readonly status:
    | 'AWAITING_PAYMENT'
    | 'ENTITLED'
    | 'DRAWN'
    | 'EXPIRED'
    | 'FORFEITED'
    | 'EXCLUDED';
  readonly closeReason:
    | 'DEADLINE'
    | 'DELETED'
    | 'WITHDRAWN'
    | 'HIDDEN_OR_SUSPENDED'
    | 'LATE_ENTRY'
    | null;
  readonly exempt: boolean;
  readonly acceptUntil: string;
  readonly deadlineAt: string;
  readonly drawAt: string;
  readonly fee: { readonly amount: number; readonly currency: string } | null;
  readonly ultrasGuide: boolean;
  readonly serverTime: string;
  readonly progress: WeekEntryProgressFields | null;
  readonly bracketPath: string | null;
}

export const MY_WEEK_ENTRY = /* GraphQL */ `
  query MyWeekEntry($productHandle: String!) {
    myWeekEntry(productHandle: $productHandle) {
      launchId
      week
      weekLabel
      status
      closeReason
      exempt
      acceptUntil
      deadlineAt
      drawAt
      fee {
        amount
        currency
      }
      ultrasGuide
      serverTime
      progress {
        alive
        eliminatedRoundName
        champion
      }
      bracketPath
    }
  }
`;

export const START_WEEK_TOURNAMENT_CHECKOUT = /* GraphQL */ `
  mutation StartWeekTournamentCheckout($launchId: ID!) {
    startWeekTournamentCheckout(launchId: $launchId) {
      purchaseId
    }
  }
`;

export const WEEK_ENTRY_PRICE: StripePrice = Object.freeze({
  lookupKey: WEEK_ENTRY_PRICE_LOOKUP_KEY,
  priceId: 'price_week_tournament_entry',
  unitAmount: 500,
  currency: 'usd',
  recurringInterval: null,
});

let currentNow = WEEK_ENTRY_TEST_NOW;

let stripe: FakeStripeGateway = createFakeStripeGateway();

const testClock: Clock = { now: () => currentNow };

// 受付期限の境界を確かめるため時計をテストごとに動かし、Stripeへ通信しないよう各テストが渡した応答だけを返す偽のゲートウェイに差し替える
const overridesModule: AppModule<GatewayApp> = {
  name: 'week-entry-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
    rebind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toDynamicValue(
      () => stripe,
    );
  }),
};

// Weekトーナメントの型定義はマッチ・プロダクトとpaymentsのMoney・CheckoutStartを参照するため、それらのスキーマモジュールと合わせて載せる
const weekEntryGateway = createGraphQLGateway({
  documents: [MY_WEEK_ENTRY, START_WEEK_TOURNAMENT_CHECKOUT],
  schemaModules: [
    mediaSchemaModule,
    profileSchemaModule,
    productSchemaModule,
    matchSchemaModule,
    paymentsSchemaModule,
    weekTournamentSchemaModule,
  ],
  overrides: [overridesModule],
});

export function setWeekEntryTestNow(now: Date): void {
  currentNow = now;
}

export function useStripe(handlers: Partial<StripeGateway>): FakeStripeGateway {
  stripe = createFakeStripeGateway(handlers);
  return stripe;
}

// 決済の開始に要るStripeの操作に成功の応答を返し、価格の照会にはWeekトーナメントの参加費を返す
export function weekEntryStartHandlers(
  sessions: StartedSessions = { sessionIds: [], inputs: [] },
): Partial<StripeGateway> {
  return {
    ...startHandlers(sessions),
    resolvePrices: () => Promise.resolve([WEEK_ENTRY_PRICE]),
  };
}

// 枠・Ultrasの加入・決済の行が利用者とプロダクトを参照するため、それらを先に消してからプロダクト・利用者を消す
export function installWeekEntryGraphQLTest(): void {
  beforeEach(async () => {
    currentNow = WEEK_ENTRY_TEST_NOW;
    stripe = createFakeStripeGateway();
    await clearMediaTables();
    await clearWeekTournamentRows();
    await db.batch([
      db.delete(ultrasNotices),
      db.delete(ultrasActivations),
      db.delete(ultrasSubscriptions),
      db.delete(paymentRefunds),
      db.delete(paymentRecords),
      db.delete(paymentStripeObjects),
      db.delete(paymentPriceSnapshots),
      db.delete(paymentPurchases),
      db.delete(paymentCustomers),
    ]);
    await clearWeekTournamentTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

// セッションの検証が差し替えた時計で行われるため、発行も同じ時刻で行う
export async function issueWeekEntrySession(
  userIndex: number,
): Promise<string> {
  const container = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
  const issued = await container
    .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
    .issue(userIdOf(userIndex), {
      clientIp: undefined,
      userAgent: undefined,
      now: currentNow,
    });
  return issued.token;
}

export function fetchMyWeekEntry(
  productHandle: string,
  options?: GatewayCallOptions,
) {
  return weekEntryGateway.call<{ myWeekEntry: WeekEntryPanelFields | null }>(
    MY_WEEK_ENTRY,
    { productHandle },
    options,
  );
}

export function startWeekTournamentCheckout(
  launchId: string,
  options?: GatewayCallOptions,
) {
  return weekEntryGateway.call<{
    startWeekTournamentCheckout: { purchaseId: string } | null;
  }>(START_WEEK_TOURNAMENT_CHECKOUT, { launchId }, options);
}
