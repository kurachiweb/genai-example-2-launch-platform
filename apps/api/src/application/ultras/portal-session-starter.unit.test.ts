import { describe, expect, test } from 'bun:test';
import { Container, type ServiceIdentifier } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import {
  type CustomerDirectory,
  type StripeGateway,
  StripeRejectedError,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import type { PaymentsEnv } from '../../../lib/core/payments/purchase-kind-contract.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { ULTRAS_TYPES } from '../../../lib/core/ultras/identifiers.ts';
import type {
  SubscriptionRow,
  SubscriptionStore,
} from '../../../lib/core/ultras/ports.ts';
import { EMPTY_SUBSCRIPTION_SNAPSHOT } from '../../../lib/core/ultras/subscription-transition.ts';
import { PAYMENTS_ERRORS } from '../payments/payments-errors.ts';
import type { PortalSessionLimits } from './portal-ports.ts';
import {
  DefaultPortalSessionStarter,
  type PortalSessionStarter,
  ULTRAS_PORTAL_RETURN_PATH,
} from './portal-session-starter.ts';
import { ULTRAS_ERRORS } from './ultras-errors.ts';
import { API_ULTRAS_TYPES } from './ultras-types.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const USER_ID = '01JD0000000000000000USER01';
const CUSTOMER_ID = 'cus_ultras_member';
const PORTAL_URL = 'https://billing.stripe.example/p/session/test_portal';
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
    pseudonymousId: '01JD0000000000000000PSEU01',
    status: 'active',
    emailVerifiedAt: new Date('2027-01-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'member@mail.example',
    nickname: '加入者',
    handle: 'member',
  },
};

const ENV: PaymentsEnv = {
  PAYMENTS_SMOKE_ENABLED: 'false',
  CLIENT_SITE_ORIGIN: 'https://client.example',
};

const ACTIVATED_SUBSCRIPTION: SubscriptionRow = {
  ...EMPTY_SUBSCRIPTION_SNAPSHOT,
  id: '01JD0000000000000000SUBS01',
  stripeSubscriptionId: 'sub_ultras_0001',
  userId: USER_ID,
  purchaseId: '01JD0000000000000000PURC01',
  stripeStatus: 'active',
  startedAt: new Date('2027-03-01T00:00:00.000Z'),
};

const unauthenticatedError = (): AppError =>
  new AppError({
    kind: 'unauthenticated',
    code: 'unauthenticated',
    message: 'ログインが必要です。',
  });

const accountUnavailableError = (): AppError =>
  new AppError({
    kind: 'forbidden',
    code: 'account_unavailable',
    message:
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
  });

interface Options {
  readonly guardError?: AppError;
  readonly subscription?: SubscriptionRow | undefined;
  readonly customerId?: string | undefined;
  readonly portalError?: Error;
}

const unexpected = (): Promise<never> =>
  Promise.reject(new Error('呼ばれない想定です'));

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否される想定です');
}

function createLimits(
  calls: string[],
  consumed: { userId: string; now: Date }[],
): PortalSessionLimits {
  return {
    consume: (userId, now) => {
      calls.push('consume');
      consumed.push({ userId, now });
      if (consumed.length > LIMIT_PER_HOUR) {
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

function createSubscriptions(
  calls: string[],
  options: Options,
): SubscriptionStore {
  return {
    findLatestActivated: (userId) => {
      calls.push('findLatestActivated');
      expect(userId).toBe(USER_ID);
      return Promise.resolve(
        'subscription' in options
          ? options.subscription
          : ACTIVATED_SUBSCRIPTION,
      );
    },
    findByStripeId: unexpected,
    findEntitledOverlapping: unexpected,
    findOverlapping: unexpected,
    findCancellable: unexpected,
    markPendingCancellation: unexpected,
  };
}

function createCustomers(calls: string[], options: Options): CustomerDirectory {
  return {
    findCustomerId: (userId) => {
      calls.push('findCustomerId');
      expect(userId).toBe(USER_ID);
      return Promise.resolve(
        'customerId' in options ? options.customerId : CUSTOMER_ID,
      );
    },
  };
}

function createGateway(
  calls: string[],
  options: Options,
  portalInputs: { customerId: string; returnUrl: string }[],
): StripeGateway {
  return {
    createPortalSession: (input) => {
      calls.push('createPortalSession');
      portalInputs.push(input);
      return options.portalError === undefined
        ? Promise.resolve({ url: PORTAL_URL })
        : Promise.reject(options.portalError);
    },
    ensureCustomer: unexpected,
    deleteCustomer: unexpected,
    resolvePrices: unexpected,
    createCheckoutSession: unexpected,
    retrieveCheckoutSession: unexpected,
    expireCheckoutSession: unexpected,
    retrieveInvoice: unexpected,
    retrieveRefund: unexpected,
    retrieveDispute: unexpected,
    retrieveSubscription: unexpected,
    findRefundByRequestId: unexpected,
    createRefund: unexpected,
    cancelSubscription: unexpected,
    retrievePaymentIntentOwner: unexpected,
  };
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const consumed: { userId: string; now: Date }[] = [];
  const portalInputs: { customerId: string; returnUrl: string }[] = [];
  const guard: AccountGuard = {
    requireWritableUser: () => {
      calls.push('requireWritableUser');
      return options.guardError === undefined
        ? Promise.resolve(CURRENT_USER)
        : Promise.reject(options.guardError);
    },
    currentUser: unexpected,
    requireUser: unexpected,
    requireVerifiedUser: unexpected,
  };
  const clock: Clock = { now: () => NOW };
  const container = new Container();
  const bindConstant = <T>(identifier: ServiceIdentifier<T>, value: T) => {
    container.bind<T>(identifier).toConstantValue(value);
  };
  bindConstant(IDENTITY_PLATFORM_TYPES.AccountGuard, guard);
  bindConstant(
    API_ULTRAS_TYPES.PortalSessionLimits,
    createLimits(calls, consumed),
  );
  bindConstant(
    ULTRAS_TYPES.SubscriptionStore,
    createSubscriptions(calls, options),
  );
  bindConstant(
    PAYMENTS_TYPES.CustomerDirectory,
    createCustomers(calls, options),
  );
  bindConstant(
    PAYMENTS_TYPES.StripeGateway,
    createGateway(calls, options, portalInputs),
  );
  bindConstant(PLATFORM_TYPES.Env, ENV);
  bindConstant(PLATFORM_TYPES.Clock, clock);
  container
    .bind<PortalSessionStarter>(API_ULTRAS_TYPES.PortalSessionStarter)
    .to(DefaultPortalSessionStarter);
  const starter = container.get<PortalSessionStarter>(
    API_ULTRAS_TYPES.PortalSessionStarter,
  );
  return { starter, calls, consumed, portalInputs };
}

describe('DefaultPortalSessionStarter', () => {
  test('戻り先のパスはプラン管理画面のPortalから戻った印の付いたパスである', () => {
    expect(ULTRAS_PORTAL_RETURN_PATH).toBe('/settings/plan?portal=returned');
  });

  test('加入とCustomerを持つ利用者には、本人のCustomerにプラン管理画面を戻り先としたセッションを作り、URLを返す', async () => {
    const { starter, portalInputs } = setup();

    const result = await starter.start(SESSION);

    expect(result).toEqual({ url: PORTAL_URL });
    expect(portalInputs).toEqual([
      {
        customerId: CUSTOMER_ID,
        returnUrl: 'https://client.example/settings/plan?portal=returned',
      },
    ]);
  });

  test('利用者の確認、回数制限、加入とCustomerの照会、Stripeの順に呼ぶ', async () => {
    const { starter, calls, consumed } = setup();

    await starter.start(SESSION);

    expect(calls).toEqual([
      'requireWritableUser',
      'consume',
      'findLatestActivated',
      'findCustomerId',
      'createPortalSession',
    ]);
    expect(consumed).toEqual([{ userId: USER_ID, now: NOW }]);
  });

  test('ログインしていなければ利用者の確認の拒否をそのまま投げ、回数を数えずStripeを呼ばない', async () => {
    const guardError = unauthenticatedError();
    const { starter, calls } = setup({ guardError });

    expect(await rejectionOf(starter.start(SESSION))).toBe(guardError);
    expect(calls).toEqual(['requireWritableUser']);
  });

  test('停止中の利用者はaccount_unavailableの拒否をそのまま投げ、回数を数えずStripeを呼ばない', async () => {
    const guardError = accountUnavailableError();
    const { starter, calls } = setup({ guardError });

    const error = await rejectionOf(starter.start(SESSION));

    expect(error).toBe(guardError);
    expect((error as AppError).code).toBe('account_unavailable');
    expect(calls).toEqual(['requireWritableUser']);
  });

  test('有効化された加入が無ければultras_portal_unavailableで拒否し、Stripeを呼ばない', async () => {
    const { starter, calls } = setup({ subscription: undefined });

    const error = await rejectionOf(starter.start(SESSION));

    expect(error).toBeInstanceOf(AppError);
    expect({
      kind: (error as AppError).kind,
      code: (error as AppError).code,
      message: (error as AppError).message,
    }).toEqual({
      kind: 'unprocessable',
      code: 'ultras_portal_unavailable',
      message: ULTRAS_ERRORS.ultras_portal_unavailable.message,
    });
    expect(calls).not.toContain('createPortalSession');
  });

  test('加入はあるがCustomerが無ければultras_portal_unavailableで拒否し、Stripeを呼ばない', async () => {
    const { starter, calls } = setup({ customerId: undefined });

    const error = await rejectionOf(starter.start(SESSION));

    expect((error as AppError).code).toBe('ultras_portal_unavailable');
    expect(calls).not.toContain('createPortalSession');
  });

  test('回数制限は加入とCustomerの照会より前に数え、21回目は照会せずrate_limit_exceededで拒否する', async () => {
    const { starter, calls } = setup();
    for (let opened = 0; opened < LIMIT_PER_HOUR; opened += 1) {
      await starter.start(SESSION);
    }
    calls.splice(0);

    const error = await rejectionOf(starter.start(SESSION));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('rate_limit_exceeded');
    expect((error as AppError).retryAfterSeconds).toBe(RETRY_AFTER_SECONDS);
    expect(calls).toEqual(['requireWritableUser', 'consume']);
  });

  test('Stripeに到達できなければpayments_unavailableに変えて投げる', async () => {
    const { starter } = setup({
      portalError: new StripeUnavailableError('Stripeに接続できません'),
    });

    const error = await rejectionOf(starter.start(SESSION));

    expect(error).toBeInstanceOf(AppError);
    expect({
      kind: (error as AppError).kind,
      code: (error as AppError).code,
      message: (error as AppError).message,
    }).toEqual({
      kind: 'unavailable',
      code: 'payments_unavailable',
      message: PAYMENTS_ERRORS.payments_unavailable.message,
    });
  });

  test('Stripeの再試行で解消しない拒否はそのまま投げ直す', async () => {
    const portalError = new StripeRejectedError({
      message: 'No such customer',
      stripeErrorCode: 'resource_missing',
    });
    const { starter } = setup({ portalError });

    expect(await rejectionOf(starter.start(SESSION))).toBe(portalError);
  });
});
