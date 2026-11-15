import { describe, expect, test } from 'bun:test';
import { Container, type ServiceIdentifier } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import {
  type CustomerStore,
  type NewPurchase,
  type PurchaseRecord,
  type PurchaseStore,
  type StripeCheckoutSessionInput,
  type StripeGateway,
  StripeRejectedError,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import type {
  PaymentsEnv,
  PurchaseKindRegistry,
  PurchaseOffer,
  PurchaseOfferDecision,
  PurchaseOfferPolicy,
  PurchaseOfferRegistration,
} from '../../../lib/core/payments/purchase-kind-contract.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  CheckoutPurchaseWriter,
  CheckoutStartLimits,
  PurchaseOfferPolicyResolver,
} from './checkout-ports.ts';
import {
  type CheckoutStarter,
  type CheckoutStartInput,
  StripeCheckoutStarter,
} from './checkout-starter.ts';
import { API_PAYMENTS_TYPES } from './payments-types.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const HOUR_MS = 3_600_000;
const USER_ID = '01JD0000000000000000USER01';
const PSEUDONYMOUS_ID = '01JD0000000000000000PSEU01';
const EMAIL = 'buyer@mail.example';
const CUSTOMER_ID = 'cus_existing';
const NEW_CUSTOMER_ID = 'cus_created';
const PRICE_ID = 'price_week_entry';
const SESSION_ID = 'cs_test_new';
const OLD_SESSION_ID = 'cs_test_old';
const OLD_PURCHASE_ID = '01JD000000000000000OLDPUR1';
const TARGET_ID = '01JD0000000000000000ENTRY1';
const OFFER_POLICY: ServiceIdentifier<PurchaseOfferPolicy> = Symbol.for(
  'test.WeekEntryOfferPolicy',
);
const LIMIT_PER_HOUR = 20;
const RETRY_AFTER_SECONDS = 1800;

const SESSION: SessionView = Object.freeze({
  principal: () =>
    Promise.resolve({
      kind: 'authenticated' as const,
      subjectKind: 'user' as const,
      subjectId: USER_ID,
      sessionId: '01JD0000000000000000SESS01',
    }),
});

const CURRENT_USER: CurrentUser = {
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_ID,
    sessionId: '01JD0000000000000000SESS01',
  },
  user: {
    id: USER_ID,
    pseudonymousId: PSEUDONYMOUS_ID,
    status: 'active',
    emailVerifiedAt: new Date('2027-01-01T00:00:00.000Z'),
    deletedAt: null,
    email: EMAIL,
    nickname: '購入する人',
    handle: 'buyer',
  },
};

const ENV: PaymentsEnv = {
  PAYMENTS_SMOKE_ENABLED: 'true',
  CLIENT_SITE_ORIGIN: 'https://client.example',
};

const DEADLINE_AT = new Date(NOW.getTime() + 10 * HOUR_MS);

const OFFER: PurchaseOffer = {
  priceLookupKey: 'week_tournament_entry_v1',
  quantity: 3,
  relatedId: '01JD0000000000000000LAUNC1',
  exclusivityKey: `week:${TARGET_ID}`,
  deadlineAt: DEADLINE_AT,
  acceptUntil: new Date(NOW.getTime() + 5 * HOUR_MS),
  fulfillableUntil: new Date(NOW.getTime() + 11 * HOUR_MS),
  summary: {
    itemName: 'Weekトーナメント参加費',
    quantityLabel: '1件',
    serviceTiming: '決済の直後',
    additionalNotes: [],
  },
  requiresBotVerification: true,
};

const INPUT_KIND = 'week_tournament_entry';

function previousPurchase(
  sessionId: string | null,
  id = OLD_PURCHASE_ID,
): PurchaseRecord {
  return {
    id,
    userId: USER_ID,
    kind: INPUT_KIND,
    targetId: TARGET_ID,
    relatedId: OFFER.relatedId,
    exclusivityKey: OFFER.exclusivityKey,
    stateToken: '01JD00000000000000OLDTOKEN',
    priceLookupKey: OFFER.priceLookupKey,
    stripePriceId: PRICE_ID,
    unitAmount: 500,
    quantity: 3,
    amountTotal: 1500,
    summary: OFFER.summary,
    deadlineAt: DEADLINE_AT,
    acceptUntil: OFFER.acceptUntil,
    fulfillableUntil: OFFER.fulfillableUntil,
    expiresAt: new Date(NOW.getTime() + HOUR_MS),
    status: 'open',
    rejectionReason: null,
    stripeCheckoutSessionId: sessionId,
    stripePaymentIntentId: null,
    stripeInvoiceId: null,
    stripeSubscriptionId: null,
    consentedAt: null,
    consentVersion: null,
    paidAt: null,
    reflectedAt: null,
    confirmationEmailStatus: 'none',
    lastEventAt: null,
    createdAt: new Date(NOW.getTime() - HOUR_MS),
  };
}

interface Options {
  readonly guardError?: AppError;
  readonly registered?: boolean;
  readonly decision?: PurchaseOfferDecision;
  readonly offer?: Partial<PurchaseOffer>;
  readonly existingCustomerId?: string;
  readonly previous?: readonly PurchaseRecord[];
  readonly pricesError?: Error;
  readonly priceMissing?: boolean;
  readonly customerError?: Error;
  readonly sessionError?: Error;
  readonly expireError?: Error;
}

const unexpected = (): Promise<never> =>
  Promise.reject(new Error('呼ばれない想定です'));

function createLimits(calls: string[]): CheckoutStartLimits {
  const counts = new Map<string, number>();
  return {
    consume: (userId) => {
      calls.push('consume');
      const count = (counts.get(userId) ?? 0) + 1;
      counts.set(userId, count);
      if (count > LIMIT_PER_HOUR) {
        return Promise.reject(
          new AppError({
            kind: 'rate_limited',
            code: 'rate_limit_exceeded',
            message:
              '操作が集中しています。しばらく待ってから再度お試しください。',
            retryAfterSeconds: RETRY_AFTER_SECONDS,
          }),
        );
      }
      return Promise.resolve();
    },
  };
}

function createGateway(
  calls: string[],
  options: Options,
  sessions: StripeCheckoutSessionInput[],
  expired: string[],
): StripeGateway {
  const fail = <T>(error: Error | undefined, value: T): Promise<T> =>
    error === undefined ? Promise.resolve(value) : Promise.reject(error);
  return {
    resolvePrices: (keys) => {
      calls.push('resolvePrices');
      const prices = options.priceMissing
        ? []
        : keys.map((lookupKey) => ({
            lookupKey,
            priceId: PRICE_ID,
            unitAmount: 500,
            currency: 'usd' as const,
            recurringInterval: null,
          }));
      return fail(options.pricesError, prices);
    },
    ensureCustomer: (input) => {
      calls.push('ensureCustomer');
      return fail(
        options.customerError,
        input.existingCustomerId === null
          ? { customerId: NEW_CUSTOMER_ID, created: true }
          : { customerId: input.existingCustomerId, created: false },
      );
    },
    createCheckoutSession: (input) => {
      calls.push('createCheckoutSession');
      sessions.push(input);
      return fail(options.sessionError, {
        id: SESSION_ID,
        status: 'open' as const,
        paymentStatus: 'unpaid' as const,
        clientSecret: 'cs_test_new_secret',
        amountTotal: 1500,
        currency: 'usd',
        expiresAt: input.expiresAt,
        paymentIntentId: null,
        paymentIntentStatus: null,
        invoiceId: null,
        subscriptionId: null,
        linkFundingSourceGroup: null,
        metadata: input.metadata,
      });
    },
    expireCheckoutSession: (sessionId) => {
      calls.push('expireCheckoutSession');
      expired.push(sessionId);
      return fail(options.expireError, 'expired' as const);
    },
    deleteCustomer: unexpected,
    retrieveCheckoutSession: unexpected,
    retrieveInvoice: unexpected,
    retrieveRefund: unexpected,
    retrieveDispute: unexpected,
    retrieveSubscription: unexpected,
    findRefundByRequestId: unexpected,
    createRefund: unexpected,
    cancelSubscription: unexpected,
    createPortalSession: unexpected,
    retrievePaymentIntentOwner: unexpected,
  };
}

function createPurchases(
  calls: string[],
  options: Options,
  attached: { purchaseId: string; sessionId: string; expiresAt: Date }[],
): PurchaseStore {
  return {
    findOpenByTarget: () => {
      calls.push('findOpenByTarget');
      return Promise.resolve(options.previous ?? []);
    },
    attachSession: (input) => {
      calls.push('attachSession');
      attached.push(input);
      return Promise.resolve();
    },
    findById: unexpected,
    findBySessionId: unexpected,
    findByPaymentIntentId: unexpected,
    findFulfilledByExclusivityKey: unexpected,
    findOpenByUser: unexpected,
    findReconcilable: unexpected,
    findStaleOpen: unexpected,
    recordConsent: unexpected,
    advanceAlone: unexpected,
    findPendingConfirmations: unexpected,
    markConfirmationEmail: unexpected,
  };
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const sessions: StripeCheckoutSessionInput[] = [];
  const expiredSessions: string[] = [];
  const replaced: { purchase: NewPurchase; supersede: readonly string[] }[] =
    [];
  const expiredPurchases: string[] = [];
  const savedCustomers: [string, string][] = [];
  const attached: { purchaseId: string; sessionId: string; expiresAt: Date }[] =
    [];
  const guard: AccountGuard = {
    requireVerifiedUser: () => {
      calls.push('requireVerifiedUser');
      return options.guardError === undefined
        ? Promise.resolve(CURRENT_USER)
        : Promise.reject(options.guardError);
    },
    currentUser: unexpected,
    requireUser: unexpected,
    requireWritableUser: unexpected,
  };
  const registration: PurchaseOfferRegistration = {
    kind: INPUT_KIND,
    offer: OFFER_POLICY,
  };
  const registry: PurchaseKindRegistry = {
    resolve: (kind, env) => {
      calls.push('resolveKind');
      expect(env).toBe(ENV);
      return options.registered === false || kind !== INPUT_KIND
        ? undefined
        : registration;
    },
  };
  const policy: PurchaseOfferPolicy = {
    describe: (request) => {
      calls.push('describe');
      expect(request).toEqual({
        userId: USER_ID,
        targetId: TARGET_ID,
        now: NOW,
      });
      return Promise.resolve(
        options.decision ?? {
          kind: 'available',
          offer: { ...OFFER, ...options.offer },
        },
      );
    },
  };
  const policies: PurchaseOfferPolicyResolver = {
    resolve: (identifier) => {
      calls.push('resolvePolicy');
      expect(identifier).toBe(OFFER_POLICY);
      return policy;
    },
  };
  const customers: CustomerStore = {
    find: () => {
      calls.push('findCustomer');
      return Promise.resolve(options.existingCustomerId);
    },
    save: (userId, customerId) => {
      calls.push('saveCustomer');
      savedCustomers.push([userId, customerId]);
      return Promise.resolve();
    },
  };
  const writer: CheckoutPurchaseWriter = {
    replaceOpen: (input) => {
      calls.push('replaceOpen');
      replaced.push(input);
      return Promise.resolve();
    },
    expire: (purchaseId) => {
      calls.push('expirePurchase');
      expiredPurchases.push(purchaseId);
      return Promise.resolve();
    },
  };
  let sequence = 0;
  const ids: IdGenerator = {
    generate: () => {
      sequence += 1;
      return `01JD0000000000000000NEWID${String(sequence)}`;
    },
  };
  const clock: Clock = { now: () => NOW };
  const container = new Container();
  const bindConstant = <T>(identifier: ServiceIdentifier<T>, value: T) => {
    container.bind<T>(identifier).toConstantValue(value);
  };
  bindConstant(IDENTITY_PLATFORM_TYPES.AccountGuard, guard);
  bindConstant(API_PAYMENTS_TYPES.CheckoutStartLimits, createLimits(calls));
  bindConstant(PAYMENTS_TYPES.PurchaseKindRegistry, registry);
  bindConstant(API_PAYMENTS_TYPES.PurchaseOfferPolicyResolver, policies);
  bindConstant(
    PAYMENTS_TYPES.StripeGateway,
    createGateway(calls, options, sessions, expiredSessions),
  );
  bindConstant(PAYMENTS_TYPES.CustomerStore, customers);
  bindConstant(
    PAYMENTS_TYPES.PurchaseStore,
    createPurchases(calls, options, attached),
  );
  bindConstant(API_PAYMENTS_TYPES.CheckoutPurchaseWriter, writer);
  bindConstant(PLATFORM_TYPES.Env, ENV);
  bindConstant(PLATFORM_TYPES.IdGenerator, ids);
  bindConstant(PLATFORM_TYPES.Clock, clock);
  container
    .bind<CheckoutStarter>(API_PAYMENTS_TYPES.CheckoutStarter)
    .to(StripeCheckoutStarter);
  const starter = container.get<CheckoutStarter>(
    API_PAYMENTS_TYPES.CheckoutStarter,
  );
  return {
    starter,
    calls,
    sessions,
    expiredSessions,
    replaced,
    expiredPurchases,
    savedCustomers,
    attached,
  };
}

function inputWith(
  calls: string[],
  overrides: Partial<CheckoutStartInput> = {},
): CheckoutStartInput {
  return {
    session: SESSION,
    kind: INPUT_KIND,
    targetId: TARGET_ID,
    humanCheck: () => {
      calls.push('humanCheck');
      return Promise.resolve();
    },
    ...overrides,
  };
}

async function caught(action: Promise<unknown>): Promise<Error> {
  try {
    await action;
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('例外が発生しませんでした。');
}

const appErrorOf = (error: Error) => {
  expect(error).toBeInstanceOf(AppError);
  const { kind, code, message, retryAfterSeconds } = error as AppError;
  return { kind, code, message, retryAfterSeconds };
};

describe('StripeCheckoutStarter', () => {
  test('利用者の確認から旧セッションの失効までを設計の順に行い、新しい購入のIDを返す', async () => {
    const harness = setup({
      existingCustomerId: CUSTOMER_ID,
      previous: [previousPurchase(OLD_SESSION_ID)],
    });

    const result = await harness.starter.start(inputWith(harness.calls));

    expect(harness.calls).toEqual([
      'requireVerifiedUser',
      'consume',
      'resolveKind',
      'resolvePolicy',
      'describe',
      'humanCheck',
      'resolvePrices',
      'findCustomer',
      'ensureCustomer',
      'findOpenByTarget',
      'replaceOpen',
      'createCheckoutSession',
      'attachSession',
      'expireCheckoutSession',
    ]);
    expect(result).toEqual({ purchaseId: '01JD0000000000000000NEWID1' });
    expect(harness.replaced.map(({ supersede }) => supersede)).toEqual([
      [OLD_PURCHASE_ID],
    ]);
    expect(harness.expiredSessions).toEqual([OLD_SESSION_ID]);
  });

  test('購入の内容・決済セッションの作成・セッションIDの保存に、提示された内容とStripeの価格を使う', async () => {
    const harness = setup({ existingCustomerId: CUSTOMER_ID });

    await harness.starter.start(inputWith(harness.calls));

    const expiresAt = new Date(NOW.getTime() + 10 * HOUR_MS);
    expect(harness.replaced).toEqual([
      {
        purchase: {
          id: '01JD0000000000000000NEWID1',
          userId: USER_ID,
          kind: INPUT_KIND,
          targetId: TARGET_ID,
          relatedId: OFFER.relatedId,
          exclusivityKey: OFFER.exclusivityKey,
          stateToken: '01JD0000000000000000NEWID2',
          priceLookupKey: OFFER.priceLookupKey,
          stripePriceId: PRICE_ID,
          unitAmount: 500,
          quantity: 3,
          amountTotal: 1500,
          summary: OFFER.summary,
          deadlineAt: DEADLINE_AT,
          acceptUntil: OFFER.acceptUntil,
          fulfillableUntil: OFFER.fulfillableUntil,
          expiresAt,
        },
        supersede: [],
      },
    ]);
    expect(harness.sessions).toEqual([
      {
        purchaseId: '01JD0000000000000000NEWID1',
        mode: 'payment',
        customerId: CUSTOMER_ID,
        priceId: PRICE_ID,
        quantity: 3,
        expiresAt,
        metadata: {
          purchase_id: '01JD0000000000000000NEWID1',
          purchase_kind: INPUT_KIND,
          pseudonymous_id: PSEUDONYMOUS_ID,
        },
      },
    ]);
    expect(harness.attached).toEqual([
      {
        purchaseId: '01JD0000000000000000NEWID1',
        sessionId: SESSION_ID,
        expiresAt,
      },
    ]);
    expect(harness.savedCustomers).toEqual([]);
  });

  test('決済期限の無い購入の決済セッションは作成から1時間で失効する', async () => {
    const harness = setup({
      offer: { deadlineAt: null, acceptUntil: null, fulfillableUntil: null },
    });

    await harness.starter.start(inputWith(harness.calls));

    expect(harness.sessions[0]?.expiresAt).toEqual(
      new Date(NOW.getTime() + HOUR_MS),
    );
  });

  test('初めての決済ではCustomerを作成し、利用者と結び付けて保存する', async () => {
    const harness = setup();

    await harness.starter.start(inputWith(harness.calls));

    expect(harness.calls.slice(7, 10)).toEqual([
      'findCustomer',
      'ensureCustomer',
      'saveCustomer',
    ]);
    expect(harness.savedCustomers).toEqual([[USER_ID, NEW_CUSTOMER_ID]]);
    expect(harness.sessions[0]?.customerId).toBe(NEW_CUSTOMER_ID);
  });

  test('bot判定を求めない購入種別ではbot判定を行わない', async () => {
    const harness = setup({ offer: { requiresBotVerification: false } });

    await harness.starter.start(inputWith(harness.calls));

    expect(harness.calls).not.toContain('humanCheck');
  });

  test('bot判定を求める購入種別でbot判定が失敗すると、価格の解決の前に拒否する', async () => {
    const harness = setup();
    const rejection = new AppError({
      kind: 'forbidden',
      code: 'bot_verification_failed',
      message: 'bot判定に失敗しました。',
    });

    const error = await caught(
      harness.starter.start(
        inputWith(harness.calls, {
          humanCheck: () => Promise.reject(rejection),
        }),
      ),
    );

    expect(error).toBe(rejection);
    expect(harness.calls).not.toContain('resolvePrices');
  });

  test('bot判定を求める購入種別にbot判定の口が渡されなければ、想定外の失敗として購入を作らない', async () => {
    const harness = setup();

    const error = await caught(
      harness.starter.start(
        inputWith(harness.calls, { humanCheck: undefined }),
      ),
    );

    expect(error).not.toBeInstanceOf(AppError);
    expect(harness.calls).not.toContain('replaceOpen');
  });

  test.each([
    ['ログインしていない', 'unauthenticated', 'unauthenticated'],
    ['メールアドレスが未確認の', 'forbidden', 'email_not_verified'],
    ['停止中・退会済みの', 'forbidden', 'account_unavailable'],
  ] as const)(
    '%s利用者は回数を数える前に拒否する',
    async (_label, kind, code) => {
      const rejection = new AppError({ kind, code, message: '拒否します。' });
      const harness = setup({ guardError: rejection });

      const error = await caught(
        harness.starter.start(inputWith(harness.calls)),
      );

      expect(error).toBe(rejection);
      expect(harness.calls).toEqual(['requireVerifiedUser']);
    },
  );

  test('21回目の決済の開始を、待つ秒数付きで購入種別の解決の前に拒否する', async () => {
    const harness = setup();
    for (let started = 0; started < LIMIT_PER_HOUR; started += 1) {
      await harness.starter.start(inputWith(harness.calls));
    }
    harness.calls.length = 0;

    const error = await caught(harness.starter.start(inputWith(harness.calls)));

    expect(appErrorOf(error)).toEqual({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    });
    expect(harness.calls).toEqual(['requireVerifiedUser', 'consume']);
  });

  test('未登録・無効の購入種別を、購入の可否を問い合わせずに拒否する', async () => {
    const harness = setup({ registered: false });

    const error = await caught(harness.starter.start(inputWith(harness.calls)));

    expect(appErrorOf(error)).toEqual({
      kind: 'unprocessable',
      code: 'purchase_kind_unavailable',
      message: 'この決済は現在ご利用いただけません。',
      retryAfterSeconds: undefined,
    });
    expect(harness.calls).toEqual([
      'requireVerifiedUser',
      'consume',
      'resolveKind',
    ]);
  });

  test('購入できない旨の答えを、そのコードと文言の422で拒否する', async () => {
    const harness = setup({
      decision: {
        kind: 'unavailable',
        code: 'entry_already_paid',
        message: 'この参加費は既に支払い済みです。',
      },
    });

    const error = await caught(harness.starter.start(inputWith(harness.calls)));

    expect(appErrorOf(error)).toEqual({
      kind: 'unprocessable',
      code: 'entry_already_paid',
      message: 'この参加費は既に支払い済みです。',
      retryAfterSeconds: undefined,
    });
    expect(harness.calls).not.toContain('humanCheck');
    expect(harness.calls).not.toContain('resolvePrices');
  });

  test('受付期限の後の開始を、価格の解決と購入の作成の前に拒否する', async () => {
    const harness = setup({ offer: { acceptUntil: NOW } });

    const error = await caught(harness.starter.start(inputWith(harness.calls)));

    expect(appErrorOf(error)).toEqual({
      kind: 'unprocessable',
      code: 'checkout_closed',
      message: '決済の受付は終了しました。',
      retryAfterSeconds: undefined,
    });
    expect(harness.calls.at(-1)).toBe('humanCheck');
  });

  test.each([
    [
      '価格の解決',
      { pricesError: new StripeUnavailableError('接続できません') },
    ],
    [
      'Customerの用意',
      { customerError: new StripeUnavailableError('接続できません') },
    ],
  ] as const)(
    '%sでStripeに到達できなければ、購入を作らずに利用できない旨を返す',
    async (_label, options) => {
      const harness = setup(options);

      const error = await caught(
        harness.starter.start(inputWith(harness.calls)),
      );

      expect(appErrorOf(error)).toMatchObject({
        kind: 'unavailable',
        code: 'payments_unavailable',
      });
      expect(harness.calls).not.toContain('replaceOpen');
    },
  );

  test('Stripeに価格が無ければ、想定外の失敗として購入を作らない', async () => {
    const harness = setup({ priceMissing: true });

    const error = await caught(harness.starter.start(inputWith(harness.calls)));

    expect(error).not.toBeInstanceOf(AppError);
    expect(harness.calls).not.toContain('replaceOpen');
  });

  test('決済セッションの作成でStripeに到達できなければ、作成した購入を失効させて利用できない旨を返す', async () => {
    const harness = setup({
      previous: [previousPurchase(OLD_SESSION_ID)],
      sessionError: new StripeUnavailableError('接続できません'),
    });

    const error = await caught(harness.starter.start(inputWith(harness.calls)));

    expect(appErrorOf(error)).toEqual({
      kind: 'unavailable',
      code: 'payments_unavailable',
      message:
        '現在、決済をご利用いただけません。決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。',
      retryAfterSeconds: undefined,
    });
    expect(harness.expiredPurchases).toEqual(['01JD0000000000000000NEWID1']);
    expect(harness.calls.slice(-2)).toEqual([
      'createCheckoutSession',
      'expirePurchase',
    ]);
    expect(harness.expiredSessions).toEqual([]);
  });

  test('決済セッションの作成をStripeが恒久的に拒否しても、作成した購入を失効させてから例外をそのまま返す', async () => {
    const rejection = new StripeRejectedError({
      message: '価格が無効です',
      stripeErrorCode: 'resource_missing',
    });
    const harness = setup({ sessionError: rejection });

    const error = await caught(harness.starter.start(inputWith(harness.calls)));

    expect(error).toBe(rejection);
    expect(harness.expiredPurchases).toEqual(['01JD0000000000000000NEWID1']);
    expect(harness.calls).not.toContain('attachSession');
  });

  test('旧セッションの失効に失敗しても、決済の開始は成功して購入のIDを返す', async () => {
    const harness = setup({
      previous: [previousPurchase(OLD_SESSION_ID)],
      expireError: new StripeUnavailableError('接続できません'),
    });

    const result = await harness.starter.start(inputWith(harness.calls));

    expect(result).toEqual({ purchaseId: '01JD0000000000000000NEWID1' });
    expect(harness.calls.at(-1)).toBe('expireCheckoutSession');
  });

  test('決済セッションIDの無い未完了の購入も置き換え、Stripeの失効はセッションのある購入だけに行う', async () => {
    const withoutSession = '01JD000000000000000OLDPUR2';
    const harness = setup({
      previous: [
        previousPurchase(null, withoutSession),
        previousPurchase(OLD_SESSION_ID),
      ],
    });

    await harness.starter.start(inputWith(harness.calls));

    expect(harness.replaced[0]?.supersede).toEqual([
      withoutSession,
      OLD_PURCHASE_ID,
    ]);
    expect(harness.expiredSessions).toEqual([OLD_SESSION_ID]);
  });
});
