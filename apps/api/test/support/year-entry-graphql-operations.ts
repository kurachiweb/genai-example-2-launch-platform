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
import { YEAR_ENTRY_PRICE_LOOKUP_KEY } from '../../lib/core/year-tournament/year-schedule.ts';
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
  clearYearTournamentRows,
  clearYearTournamentTables,
} from '../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { matchSchemaModule } from '../../src/presentation/graphql/modules/match/index.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { paymentsSchemaModule } from '../../src/presentation/graphql/modules/payments/index.ts';
import { productSchemaModule } from '../../src/presentation/graphql/modules/product/index.ts';
import { profileSchemaModule } from '../../src/presentation/graphql/modules/profile/index.ts';
import { weekTournamentSchemaModule } from '../../src/presentation/graphql/modules/week-tournament/index.ts';
import { yearTournamentSchemaModule } from '../../src/presentation/graphql/modules/year-tournament/index.ts';
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

// 2026-11-23のWeek優勝の枠の、2027年の受付期限(2027-05-24 23:00)より前の時刻
export const YEAR_ENTRY_TEST_NOW = fromBusinessDateTime(
  parseBusinessDate('2026-11-25'),
  { hour: 12, minute: 0 },
);

export interface YearEntryProgressFields {
  readonly alive: boolean;
  readonly eliminatedRoundName: string | null;
  readonly champion: boolean;
}

export interface YearEntryPanelFields {
  readonly launchId: string;
  readonly year: number;
  readonly yearLabel: string;
  readonly weekLabel: string;
  readonly finalDate: string;
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
    | 'OVER_CAPACITY'
    | 'LATE_ENTRY'
    | null;
  readonly refundable: boolean;
  readonly exempt: boolean;
  readonly acceptUntil: string;
  readonly deadlineAt: string;
  readonly drawAt: string;
  readonly fee: { readonly amount: number; readonly currency: string } | null;
  readonly serverTime: string;
  readonly progress: YearEntryProgressFields | null;
  readonly bracketPath: string | null;
}

export const MY_YEAR_ENTRY = /* GraphQL */ `
  query MyYearEntry($productHandle: String!) {
    myYearEntry(productHandle: $productHandle) {
      launchId
      year
      yearLabel
      weekLabel
      finalDate
      status
      closeReason
      refundable
      exempt
      acceptUntil
      deadlineAt
      drawAt
      fee {
        amount
        currency
      }
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

export const START_YEAR_TOURNAMENT_CHECKOUT = /* GraphQL */ `
  mutation StartYearTournamentCheckout($launchId: ID!) {
    startYearTournamentCheckout(launchId: $launchId) {
      purchaseId
    }
  }
`;

export const YEAR_ENTRY_PRICE: StripePrice = Object.freeze({
  lookupKey: YEAR_ENTRY_PRICE_LOOKUP_KEY,
  priceId: 'price_year_tournament_entry',
  unitAmount: 2000,
  currency: 'usd',
  recurringInterval: null,
});

let currentNow = YEAR_ENTRY_TEST_NOW;

let stripe: FakeStripeGateway = createFakeStripeGateway();

const testClock: Clock = { now: () => currentNow };

// 受付期限の境界を確かめるため時計をテストごとに動かし、Stripeへ通信しないよう各テストが渡した応答だけを返す偽のゲートウェイに差し替える
const overridesModule: AppModule<GatewayApp> = {
  name: 'year-entry-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
    rebind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toDynamicValue(
      () => stripe,
    );
  }),
};

// Yearトーナメントの型定義はマッチ・プロダクト・Weekのブラケットの型とpaymentsのMoney・CheckoutStartを参照するため、それらのスキーマモジュールと合わせて載せる
const yearEntryGateway = createGraphQLGateway({
  documents: [MY_YEAR_ENTRY, START_YEAR_TOURNAMENT_CHECKOUT],
  schemaModules: [
    mediaSchemaModule,
    profileSchemaModule,
    productSchemaModule,
    matchSchemaModule,
    paymentsSchemaModule,
    weekTournamentSchemaModule,
    yearTournamentSchemaModule,
  ],
  overrides: [overridesModule],
});

export function setYearEntryTestNow(now: Date): void {
  currentNow = now;
}

export function useStripe(handlers: Partial<StripeGateway>): FakeStripeGateway {
  stripe = createFakeStripeGateway(handlers);
  return stripe;
}

// 決済の開始に要るStripeの操作に成功の応答を返し、価格の照会にはYearトーナメントの参加費を返す
export function yearEntryStartHandlers(
  sessions: StartedSessions = { sessionIds: [], inputs: [] },
): Partial<StripeGateway> {
  return {
    ...startHandlers(sessions),
    resolvePrices: () => Promise.resolve([YEAR_ENTRY_PRICE]),
  };
}

// 枠・Ultrasの加入・決済の行が利用者とプロダクトを参照するため、それらを先に消してからブラケット・Weekの行を消す
export function installYearEntryGraphQLTest(): void {
  beforeEach(async () => {
    currentNow = YEAR_ENTRY_TEST_NOW;
    stripe = createFakeStripeGateway();
    await clearMediaTables();
    await clearYearTournamentRows();
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
    await clearYearTournamentTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

// セッションの検証が差し替えた時計で行われるため、発行も同じ時刻で行う
export async function issueYearEntrySession(
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

export function fetchMyYearEntry(
  productHandle: string,
  options?: GatewayCallOptions,
) {
  return yearEntryGateway.call<{ myYearEntry: YearEntryPanelFields | null }>(
    MY_YEAR_ENTRY,
    { productHandle },
    options,
  );
}

export function startYearTournamentCheckout(
  launchId: string,
  options?: GatewayCallOptions,
) {
  return yearEntryGateway.call<{
    startYearTournamentCheckout: { purchaseId: string } | null;
  }>(START_YEAR_TOURNAMENT_CHECKOUT, { launchId }, options);
}
