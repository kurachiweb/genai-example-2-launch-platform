import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { users } from '../../db/schema/identity/users.ts';
import { paymentPurchases } from '../../db/schema/payments/payment-purchases.ts';
import { paymentRecords } from '../../db/schema/payments/payment-records.ts';
import type { AppModule } from '../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import type {
  NewPaymentRecord,
  NewPurchase,
  StripeCheckoutSessionInput,
  StripeCheckoutSessionSnapshot,
  StripeGateway,
  StripePrice,
} from '../../lib/core/payments/ports.ts';
import type { PurchaseOfferPolicy } from '../../lib/core/payments/purchase-kind-contract.ts';
import {
  createInvocationContainer,
  type InvocationScope,
} from '../../lib/workers/di/invocation-container.ts';
import { D1PurchaseStore } from '../../lib/workers/payments/d1-purchase-store.ts';
import { createPaymentsPlatformModule } from '../../lib/workers/payments/payments-platform-module.ts';
import {
  SMOKE_PURCHASE_LOOKUP_KEY,
  SmokePurchaseOfferPolicy,
} from '../../lib/workers/payments/smoke-purchase.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from '../../lib/workers/payments/testing/fake-stripe-gateway.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  newPaymentRecord,
  newPurchase,
  purchaseIdOf,
  T0,
  userIdOf,
} from '../../lib/workers/payments/testing/payment-store-fixtures.ts';
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
import type { SessionIssuer } from '../../src/application/identity/session-issuer.ts';
import { MODULES } from '../../src/composition/modules.ts';
import { API_PAYMENTS_MODULE } from '../../src/composition/payments-module.ts';
import { paymentsSchemaModule } from '../../src/presentation/graphql/modules/payments/index.ts';
import {
  createGraphQLGateway,
  type GatewayApp,
  type GatewayCallOptions,
  type GatewayResponse,
} from './graphql-gateway.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from './observability-recording.ts';

export interface MoneyFields {
  readonly amount: number;
  readonly currency: string;
}

export interface CheckoutFields {
  readonly purchaseId: string;
  readonly kind: string;
  readonly status: string;
  readonly rejectionReason: string | null;
  readonly clientSecret: string | null;
  readonly unitPrice: MoneyFields;
  readonly quantity: number;
  readonly total: MoneyFields;
  readonly summary: {
    readonly itemName: string;
    readonly quantityLabel: string;
    readonly serviceTiming: string;
    readonly additionalNotes: readonly string[];
    readonly isSubscription: boolean;
  };
  readonly acceptUntil: string | null;
  readonly expiresAt: string;
  readonly consentVersion: string;
  readonly canRestart: boolean;
}

export interface PaymentRecordFields {
  readonly id: string;
  readonly kind: string;
  readonly purpose: string;
  readonly amount: MoneyFields;
  readonly quantity: number | null;
  readonly status: string;
  readonly occurredAt: string;
}

export interface PaymentHistoryFields {
  readonly nodes: readonly PaymentRecordFields[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

const CHECKOUT_FIELDS = /* GraphQL */ `
  purchaseId
  kind
  status
  rejectionReason
  clientSecret
  unitPrice {
    amount
    currency
  }
  quantity
  total {
    amount
    currency
  }
  summary {
    itemName
    quantityLabel
    serviceTiming
    additionalNotes
    isSubscription
  }
  acceptUntil
  expiresAt
  consentVersion
  canRestart
`;

export const CHECKOUT = /* GraphQL */ `
  query ClientCheckout($purchaseId: ID!) {
    checkout(purchaseId: $purchaseId) {
      ${CHECKOUT_FIELDS}
    }
  }
`;

export const PAYMENT_HISTORY = /* GraphQL */ `
  query ClientPaymentHistory($first: Int, $after: String) {
    paymentHistory(first: $first, after: $after) {
      nodes {
        id
        kind
        purpose
        amount {
          amount
          currency
        }
        quantity
        status
        occurredAt
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const RECORD_CHECKOUT_CONSENT = /* GraphQL */ `
  mutation ClientRecordCheckoutConsent($purchaseId: ID!) {
    recordCheckoutConsent(purchaseId: $purchaseId) {
      ${CHECKOUT_FIELDS}
    }
  }
`;

export const CONFIRM_CHECKOUT_RETURN = /* GraphQL */ `
  mutation ClientConfirmCheckoutReturn($sessionId: String!) {
    confirmCheckoutReturn(sessionId: $sessionId) {
      checkout {
        ${CHECKOUT_FIELDS}
      }
    }
  }
`;

export const START_SMOKE_CHECKOUT = /* GraphQL */ `
  mutation ClientStartSmokeCheckout {
    startSmokeCheckout {
      purchaseId
    }
  }
`;

let stripe: FakeStripeGateway = createFakeStripeGateway();

let envOverrides: Partial<Pick<Env, 'PAYMENTS_SMOKE_ENABLED'>> = {};

let offerPolicy: PurchaseOfferPolicy | undefined;

// Stripeへ通信しないよう各テストが渡した応答だけを返す偽のゲートウェイへ、疎通確認の購入の可否の口と環境の値はテストが渡したときだけ差し替える
const overridesModule: AppModule<GatewayApp> = {
  name: 'payments-graphql-test-overrides',
  bindings: new ContainerModule(({ rebind }) => {
    rebind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toDynamicValue(
      () => stripe,
    );
    rebind<PurchaseOfferPolicy>(
      PAYMENTS_TYPES.SmokePurchaseOffer,
    ).toDynamicValue(() => offerPolicy ?? new SmokePurchaseOfferPolicy());
    rebind<Env>(PLATFORM_TYPES.Env).toDynamicValue((context) => ({
      ...context.get<InvocationScope<Env>>(PLATFORM_TYPES.InvocationScope).env,
      ...envOverrides,
    }));
  }),
};

export const paymentsGateway = createGraphQLGateway({
  documents: [
    CHECKOUT,
    PAYMENT_HISTORY,
    RECORD_CHECKOUT_CONSENT,
    CONFIRM_CHECKOUT_RETURN,
    START_SMOKE_CHECKOUT,
  ],
  schemaModules: [paymentsSchemaModule],
  overrides: [
    createPaymentsPlatformModule('api'),
    API_PAYMENTS_MODULE,
    overridesModule,
  ],
});

export function useStripe(handlers: Partial<StripeGateway>): FakeStripeGateway {
  stripe = createFakeStripeGateway(handlers);
  return stripe;
}

export function usePaymentsEnv(
  overrides: Partial<Pick<Env, 'PAYMENTS_SMOKE_ENABLED'>>,
): void {
  envOverrides = overrides;
}

export function useSmokeOffer(policy: PurchaseOfferPolicy): void {
  offerPolicy = policy;
}

export interface PaymentsTestContext {
  readonly logs: () => readonly LoggedObject[];
}

// 各テストの前に決済と利用者のテーブル・ログの記録・差し替えを戻す
export function installPaymentsGraphQLTest(): PaymentsTestContext {
  let logs: LoggedObject[] = [];

  beforeAll(() => {
    logs = configureRecordingLogs();
  });

  beforeEach(async () => {
    await clearPaymentTables();
    stripe = createFakeStripeGateway();
    envOverrides = {};
    offerPolicy = undefined;
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

export const SMOKE_PRICE: StripePrice = Object.freeze({
  lookupKey: SMOKE_PURCHASE_LOOKUP_KEY,
  priceId: 'price_payments_smoke',
  unitAmount: 100,
  currency: 'usd',
  recurringInterval: null,
});

export function customerIdOf(userIndex: number): string {
  return `cus_test_${String(userIndex)}`;
}

export function clientSecretOf(sessionId: string): string {
  return `${sessionId}_secret_test`;
}

export function openSessionOf(
  input: Pick<StripeCheckoutSessionInput, 'purchaseId' | 'expiresAt'> & {
    readonly metadata?: Readonly<Record<string, string>>;
  },
  sessionId: string,
): StripeCheckoutSessionSnapshot {
  return {
    id: sessionId,
    status: 'open',
    paymentStatus: 'unpaid',
    clientSecret: clientSecretOf(sessionId),
    amountTotal: SMOKE_PRICE.unitAmount,
    currency: 'usd',
    expiresAt: input.expiresAt,
    paymentIntentId: null,
    paymentIntentStatus: null,
    invoiceId: null,
    subscriptionId: null,
    linkFundingSourceGroup: null,
    metadata: input.metadata ?? { purchase_id: input.purchaseId },
  };
}

export interface StartedSessions {
  readonly sessionIds: string[];
  readonly inputs: StripeCheckoutSessionInput[];
}

// 決済の開始に要るStripeの操作に成功の応答を返す。決済セッションのIDは作成の順に振る
export function startHandlers(
  sessions: StartedSessions = { sessionIds: [], inputs: [] },
): Partial<StripeGateway> {
  return {
    resolvePrices: () => Promise.resolve([SMOKE_PRICE]),
    ensureCustomer: ({ existingCustomerId }) =>
      Promise.resolve({
        customerId: existingCustomerId ?? 'cus_test_payments',
        created: existingCustomerId === null,
      }),
    createCheckoutSession: (input) => {
      const sessionId = `cs_test_${String(sessions.sessionIds.length + 1)}`;
      sessions.sessionIds.push(sessionId);
      sessions.inputs.push(input);
      return Promise.resolve(openSessionOf(input, sessionId));
    },
    expireCheckoutSession: () => Promise.resolve('expired'),
  };
}

export async function insertVerifiedUser(index: number): Promise<void> {
  await insertUser(index, { emailVerifiedAt: T0 });
}

export async function suspendUser(index: number): Promise<void> {
  await db
    .update(users)
    .set({ status: 'suspended' })
    .where(eq(users.id, userIdOf(index)));
}

// 本物の発行の部品で、保存済みの利用者のセッションを作る
export async function issueUserSession(userIndex: number): Promise<string> {
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
      now: new Date(),
    });
  return issued.token;
}

export async function insertStoredPurchase(
  index: number,
  columns: Partial<NewPurchase> = {},
): Promise<void> {
  await db.batch([new D1PurchaseStore(db).create(newPurchase(index, columns))]);
}

export async function readPurchase(purchaseId: string) {
  const [row] = await db
    .select()
    .from(paymentPurchases)
    .where(eq(paymentPurchases.id, purchaseId));
  return row;
}

export async function insertPaymentRecords(
  records: readonly NewPaymentRecord[],
): Promise<void> {
  for (const record of records) {
    await db.insert(paymentRecords).values(record);
  }
}

export { insertUser, newPaymentRecord, purchaseIdOf, T0, userIdOf };

export async function markRejected(
  purchaseId: string,
  reason: 'late' | 'ineligible' | 'duplicate',
): Promise<void> {
  await db
    .update(paymentPurchases)
    .set({ status: 'rejected', rejectionReason: reason })
    .where(eq(paymentPurchases.id, purchaseId));
}

export function codesOf(response: GatewayResponse): (string | undefined)[] {
  return (response.errors ?? []).map((error) => error.extensions?.code);
}

export function detailsOf(response: GatewayResponse) {
  return response.errors?.[0]?.extensions?.details ?? [];
}

export function fetchCheckout(
  purchaseId: string,
  options?: GatewayCallOptions,
) {
  return paymentsGateway.call<{ checkout: CheckoutFields | null }>(
    CHECKOUT,
    { purchaseId },
    options,
  );
}

export function fetchPaymentHistory(
  variables: { readonly first?: number | null; readonly after?: string | null },
  options?: GatewayCallOptions,
) {
  return paymentsGateway.call<{ paymentHistory: PaymentHistoryFields | null }>(
    PAYMENT_HISTORY,
    variables,
    options,
  );
}

export function recordCheckoutConsent(
  purchaseId: string,
  options?: GatewayCallOptions,
) {
  return paymentsGateway.call<{
    recordCheckoutConsent: CheckoutFields | null;
  }>(RECORD_CHECKOUT_CONSENT, { purchaseId }, options);
}

export function confirmCheckoutReturn(
  sessionId: string,
  options?: GatewayCallOptions,
) {
  return paymentsGateway.call<{
    confirmCheckoutReturn: { checkout: CheckoutFields } | null;
  }>(CONFIRM_CHECKOUT_RETURN, { sessionId }, options);
}

export function startSmokeCheckout(options?: GatewayCallOptions) {
  return paymentsGateway.call<{
    startSmokeCheckout: { purchaseId: string } | null;
  }>(START_SMOKE_CHECKOUT, {}, options);
}
