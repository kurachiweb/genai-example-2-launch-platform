import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, vi } from 'vitest';

import { products } from '../../db/schema/product/products.ts';
import {
  SPONSORSHIP_PRICE_LOOKUP_KEYS,
  SPONSORSHIP_TIERS,
} from '../../common-lib/sponsorship/sponsorship-tiers.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type {
  StripeGateway,
  StripePrice,
} from '../../lib/core/payments/ports.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearMediaTables } from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from '../../lib/workers/payments/testing/fake-stripe-gateway.ts';
import {
  clearSponsorshipTables,
  db,
  productIdOf,
  userIdOf,
} from '../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { mediaSchemaModule } from '../../src/presentation/graphql/modules/media/index.ts';
import { paymentsSchemaModule } from '../../src/presentation/graphql/modules/payments/index.ts';
import { sponsorshipSchemaModule } from '../../src/presentation/graphql/modules/sponsorship/index.ts';
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
  detailsOf,
  readPurchase,
  type StartedSessions,
} from './payments-graphql-operations.ts';

// 業務日付2026-11-25の業務時刻12:00
export const SPONSORSHIP_TEST_NOW = new Date('2026-11-25T20:00:00.000Z');

// 業務日付2026-11-26の0:00
export const NEXT_DAY_STARTS_AT = '2026-11-26T08:00:00.000Z';

export const SPONSORSHIP_APPLY_BOT_ACTION = 'sponsorship_apply';

export type TierValue = 'LEGEND' | 'GOLD' | 'SILVER';

export interface MoneyFields {
  readonly amount: number;
  readonly currency: string;
}

export interface MediaImageFields {
  readonly id: string;
}

export interface DateWindowFields {
  readonly earliest: string;
  readonly latest: string;
  readonly unavailable: readonly {
    readonly from: string;
    readonly to: string;
    readonly reason: 'OVERLAP';
  }[];
}

export interface PeriodWindowFields {
  readonly businessToday: string;
  readonly nextDayStartsAt: string;
  readonly start: DateWindowFields;
  readonly end: DateWindowFields | null;
}

export interface OfferFields {
  readonly tiers: readonly {
    readonly tier: TierValue;
    readonly unitPrice: MoneyFields | null;
  }[];
  readonly eligibleProducts:
    | readonly {
        readonly id: string;
        readonly handle: string;
        readonly name: string;
        readonly logo: MediaImageFields | null;
      }[]
    | null;
}

export interface SponsoredAdFields {
  readonly id: string;
  readonly tier: TierValue;
  readonly productName: string;
  readonly tagline: string | null;
  readonly logo: MediaImageFields | null;
  readonly websiteUrl: string | null;
}

export interface PlacementsFields {
  readonly legend: readonly SponsoredAdFields[];
  readonly gold: readonly SponsoredAdFields[];
  readonly silver: readonly SponsoredAdFields[];
}

export interface RefundFields {
  readonly days: number;
  readonly amount: MoneyFields | null;
  readonly status: 'REQUESTED' | 'ALREADY_REFUNDED' | 'REJECTED';
}

export interface MySponsorshipFields {
  readonly id: string;
  readonly product: {
    readonly handle: string;
    readonly name: string;
    readonly logo: MediaImageFields | null;
    readonly listed: boolean;
  } | null;
  readonly tier: TierValue;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly days: number;
  readonly amountPaid: MoneyFields | null;
  readonly status:
    | 'PENDING_PAYMENT'
    | 'SCHEDULED'
    | 'ACTIVE'
    | 'PAUSED'
    | 'ENDED'
    | 'TERMINATED';
  readonly terminatedOn: string | null;
  readonly terminationReason: string | null;
  readonly terminationRefund: RefundFields | null;
  readonly displayStopRefund: RefundFields | null;
  readonly canResume: boolean;
  readonly createdAt: string;
}

export interface MySponsorshipsFields {
  readonly nodes: readonly MySponsorshipFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
  readonly nextDayStartsAt: string;
}

export interface ApplyFields {
  readonly productId: string;
  readonly tier: TierValue;
  readonly startsOn: string;
  readonly endsOn: string;
}

const MEDIA_IMAGE_SELECTION = /* GraphQL */ `
  id
`;

const DATE_WINDOW_SELECTION = /* GraphQL */ `
  earliest
  latest
  unavailable {
    from
    to
    reason
  }
`;

const SPONSORED_AD_SELECTION = /* GraphQL */ `
  id
  tier
  productName
  tagline
  logo { ${MEDIA_IMAGE_SELECTION} }
  websiteUrl
`;

const REFUND_SELECTION = /* GraphQL */ `
  days
  amount {
    amount
    currency
  }
  status
`;

export const SPONSORSHIP_OFFER = /* GraphQL */ `
  query SponsorshipOffer {
    sponsorshipOffer {
      tiers {
        tier
        unitPrice {
          amount
          currency
        }
      }
      eligibleProducts {
        id
        handle
        name
        logo { ${MEDIA_IMAGE_SELECTION} }
      }
    }
  }
`;

export const SPONSORSHIP_PERIOD_WINDOW = /* GraphQL */ `
  query SponsorshipPeriodWindow(
    $productId: ID!
    $tier: SponsorshipTier!
    $startsOn: String
  ) {
    sponsorshipPeriodWindow(
      productId: $productId
      tier: $tier
      startsOn: $startsOn
    ) {
      businessToday
      nextDayStartsAt
      start { ${DATE_WINDOW_SELECTION} }
      end { ${DATE_WINDOW_SELECTION} }
    }
  }
`;

export const SPONSORED_PLACEMENTS = /* GraphQL */ `
  query SponsoredPlacements {
    sponsoredPlacements {
      legend { ${SPONSORED_AD_SELECTION} }
      gold { ${SPONSORED_AD_SELECTION} }
      silver { ${SPONSORED_AD_SELECTION} }
    }
  }
`;

export const MY_SPONSORSHIPS = /* GraphQL */ `
  query MySponsorships($first: Int!, $after: String) {
    mySponsorships(first: $first, after: $after) {
      nodes {
        id
        product {
          handle
          name
          logo { ${MEDIA_IMAGE_SELECTION} }
          listed
        }
        tier
        startsOn
        endsOn
        days
        amountPaid {
          amount
          currency
        }
        status
        terminatedOn
        terminationReason
        terminationRefund { ${REFUND_SELECTION} }
        displayStopRefund { ${REFUND_SELECTION} }
        canResume
        createdAt
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      nextDayStartsAt
    }
  }
`;

export const ACTIVE_SPONSORSHIP_COUNT = /* GraphQL */ `
  query ActiveSponsorshipCount($productHandle: String!) {
    activeSponsorshipCount(productHandle: $productHandle)
  }
`;

export const APPLY_SPONSORSHIP = /* GraphQL */ `
  mutation ApplySponsorship($input: ApplySponsorshipInput!) {
    applySponsorship(input: $input) {
      purchaseId
    }
  }
`;

export const RESUME_SPONSORSHIP_CHECKOUT = /* GraphQL */ `
  mutation ResumeSponsorshipCheckout($id: ID!) {
    resumeSponsorshipCheckout(id: $id) {
      purchaseId
    }
  }
`;

const UNIT_AMOUNTS = Object.freeze({
  legend: 3_000,
  gold: 1_000,
  silver: 300,
});

export const SPONSORSHIP_PRICES: readonly StripePrice[] = Object.freeze(
  SPONSORSHIP_TIERS.map((tier) =>
    Object.freeze({
      lookupKey: SPONSORSHIP_PRICE_LOOKUP_KEYS[tier],
      priceId: `price_sponsorship_${tier}`,
      unitAmount: UNIT_AMOUNTS[tier],
      currency: 'usd',
      recurringInterval: null,
    }),
  ),
);

let currentNow = SPONSORSHIP_TEST_NOW;

let stripe: FakeStripeGateway = createFakeStripeGateway();

const testClock: Clock = { now: () => currentNow };

// 日付の境界を確かめるため時計をテストごとに動かし、Stripeへ通信しないよう各テストが渡した応答だけを返す偽のゲートウェイに差し替える
const overridesModule: AppModule<GatewayApp> = {
  name: 'sponsorship-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(testClock);
    rebind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toDynamicValue(
      () => stripe,
    );
  }),
};

// スポンサー広告の型定義はpaymentsのMoney・CheckoutStartとメディアのMediaImageを参照するため、それらのスキーマモジュールと合わせて載せる
const sponsorshipGateway = createGraphQLGateway({
  documents: [
    SPONSORSHIP_OFFER,
    SPONSORSHIP_PERIOD_WINDOW,
    SPONSORED_PLACEMENTS,
    MY_SPONSORSHIPS,
    ACTIVE_SPONSORSHIP_COUNT,
    APPLY_SPONSORSHIP,
    RESUME_SPONSORSHIP_CHECKOUT,
  ],
  schemaModules: [
    mediaSchemaModule,
    paymentsSchemaModule,
    sponsorshipSchemaModule,
  ],
  overrides: [overridesModule],
});

export function setSponsorshipTestNow(now: Date): void {
  currentNow = now;
}

export function useStripe(handlers: Partial<StripeGateway>): FakeStripeGateway {
  stripe = createFakeStripeGateway(handlers);
  return stripe;
}

// 決済の開始に要るStripeの操作に成功の応答を返し、価格の照会には3つのティアの価格を返す
export function sponsorshipStartHandlers(
  sessions: StartedSessions = { sessionIds: [], inputs: [] },
): Partial<StripeGateway> {
  return {
    ...startHandlers(sessions),
    resolvePrices: () => Promise.resolve(SPONSORSHIP_PRICES),
  };
}

export function installSponsorshipGraphQLTest(): void {
  beforeEach(async () => {
    currentNow = SPONSORSHIP_TEST_NOW;
    stripe = createFakeStripeGateway();
    await clearSponsorshipTables();
    await clearMediaTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

// セッションの検証が差し替えた時計で行われるため、発行も同じ時刻で行う
export async function issueSponsorshipSession(
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

export async function updateSponsorProduct(
  index: number,
  columns: Partial<typeof products.$inferInsert>,
): Promise<void> {
  await db
    .update(products)
    .set(columns)
    .where(eq(products.id, productIdOf(index)));
}

export function fetchSponsorshipOffer(options?: GatewayCallOptions) {
  return sponsorshipGateway.call<{ sponsorshipOffer: OfferFields | null }>(
    SPONSORSHIP_OFFER,
    {},
    options,
  );
}

export function fetchPeriodWindow(
  variables: {
    readonly productId: string;
    readonly tier: TierValue;
    readonly startsOn?: string | null;
  },
  options?: GatewayCallOptions,
) {
  return sponsorshipGateway.call<{
    sponsorshipPeriodWindow: PeriodWindowFields | null;
  }>(SPONSORSHIP_PERIOD_WINDOW, variables, options);
}

export function fetchSponsoredPlacements(options?: GatewayCallOptions) {
  return sponsorshipGateway.call<{
    sponsoredPlacements: PlacementsFields | null;
  }>(SPONSORED_PLACEMENTS, {}, options);
}

export function fetchMySponsorships(
  variables: { readonly first: number; readonly after?: string | null },
  options?: GatewayCallOptions,
) {
  return sponsorshipGateway.call<{
    mySponsorships: MySponsorshipsFields | null;
  }>(MY_SPONSORSHIPS, variables, options);
}

export function fetchActiveSponsorshipCount(
  productHandle: string,
  options?: GatewayCallOptions,
) {
  return sponsorshipGateway.call<{ activeSponsorshipCount: number | null }>(
    ACTIVE_SPONSORSHIP_COUNT,
    { productHandle },
    options,
  );
}

export function applySponsorship(
  input: ApplyFields,
  options?: GatewayCallOptions,
) {
  return sponsorshipGateway.call<{
    applySponsorship: { purchaseId: string } | null;
  }>(APPLY_SPONSORSHIP, { input }, options);
}

export function resumeSponsorshipCheckout(
  id: string,
  options?: GatewayCallOptions,
) {
  return sponsorshipGateway.call<{
    resumeSponsorshipCheckout: { purchaseId: string } | null;
  }>(RESUME_SPONSORSHIP_CHECKOUT, { id }, options);
}
