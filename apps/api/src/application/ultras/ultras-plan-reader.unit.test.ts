import { describe, expect, test } from 'bun:test';

import { ULTRAS_PRICE_LOOKUP_KEY } from '../../../common-lib/ultras/plan-status.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../lib/core/identity/account-guard.ts';
import type {
  PriceCatalog,
  PriceCatalogResult,
  StripePrice,
} from '../../../lib/core/payments/ports.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  UltrasEntitlements,
  UltrasPlanView,
  UltrasPromotionFlagReader,
} from '../../../lib/core/ultras/ports.ts';
import { DefaultUltrasPlanReader } from './ultras-plan-reader.ts';

const NOW = new Date('2027-04-01T09:00:00.000Z');
const USER_ID = '01JD0000000000000000USER01';
const DAY_MS = 86_400_000;

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
    nickname: '加入する人',
    handle: 'member',
  },
};

const MONTHLY_PRICE: StripePrice = Object.freeze({
  lookupKey: ULTRAS_PRICE_LOOKUP_KEY,
  priceId: 'price_ultras_monthly',
  unitAmount: 999,
  currency: 'usd',
  recurringInterval: 'month',
});

const OTHER_PRICE: StripePrice = Object.freeze({
  lookupKey: 'week_tournament_entry_v1',
  priceId: 'price_week_entry',
  unitAmount: 500,
  currency: 'usd',
  recurringInterval: null,
});

const ACTIVE_PLAN: UltrasPlanView = Object.freeze({
  status: 'active',
  startedAt: new Date(NOW.getTime() - 10 * DAY_MS),
  currentPeriodEndsAt: new Date(NOW.getTime() + 20 * DAY_MS),
  benefitEndsAt: null,
  canceledAt: null,
});

const ENDED_PLAN: UltrasPlanView = Object.freeze({
  status: 'ended',
  startedAt: new Date(NOW.getTime() - 60 * DAY_MS),
  currentPeriodEndsAt: new Date(NOW.getTime() - 30 * DAY_MS),
  benefitEndsAt: new Date(NOW.getTime() - 30 * DAY_MS),
  canceledAt: new Date(NOW.getTime() - 40 * DAY_MS),
});

const PAYMENTS_UNAVAILABLE = new AppError({
  kind: 'unavailable',
  code: 'payments_unavailable',
  message: '現在、決済をご利用いただけません。',
});

const FIXED_CLOCK: Clock = Object.freeze({ now: () => NOW });

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

interface Fakes {
  readonly calls: string[];
  readonly priceLookups: (readonly string[])[];
  readonly entitlementCalls: { readonly userId: string; readonly at: Date }[];
}

interface FakeOptions {
  readonly enabled?: boolean;
  readonly prices?: PriceCatalogResult | Error;
  readonly currentUser?: CurrentUser | undefined;
  readonly plan?: UltrasPlanView | null;
  readonly entitled?: boolean;
}

function createFlags(
  fakes: Fakes,
  enabled: boolean,
): UltrasPromotionFlagReader {
  return {
    isEnabled: () => {
      fakes.calls.push('isEnabled');
      return Promise.resolve(enabled);
    },
  };
}

function createPrices(
  fakes: Fakes,
  result: PriceCatalogResult | Error,
): PriceCatalog {
  return {
    getPrices: (lookupKeys) => {
      fakes.calls.push('getPrices');
      fakes.priceLookups.push(lookupKeys);
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  };
}

function createGuard(
  fakes: Fakes,
  currentUser: CurrentUser | undefined,
): AccountGuard {
  return {
    currentUser: () => {
      fakes.calls.push('currentUser');
      return Promise.resolve(currentUser);
    },
    requireUser: unexpected,
    requireWritableUser: unexpected,
    requireVerifiedUser: unexpected,
  };
}

function createEntitlements(
  fakes: Fakes,
  plan: UltrasPlanView | null,
  entitled: boolean,
): UltrasEntitlements {
  return {
    currentPlan: (userId, now) => {
      fakes.calls.push('currentPlan');
      fakes.entitlementCalls.push({ userId, at: now });
      return Promise.resolve(plan);
    },
    isEntitledAt: (userId, at) => {
      fakes.calls.push('isEntitledAt');
      fakes.entitlementCalls.push({ userId, at });
      return Promise.resolve(entitled);
    },
    wasEntitledDuring: unexpected,
    entitledUsersAt: unexpected,
    entitledUsersDuring: unexpected,
  };
}

function setup(options: FakeOptions = {}): {
  readonly reader: DefaultUltrasPlanReader;
  readonly fakes: Fakes;
} {
  const fakes: Fakes = { calls: [], priceLookups: [], entitlementCalls: [] };
  const reader = new DefaultUltrasPlanReader(
    createFlags(fakes, options.enabled ?? true),
    createEntitlements(fakes, options.plan ?? null, options.entitled ?? false),
    createPrices(
      fakes,
      options.prices ?? { prices: [MONTHLY_PRICE], stale: false },
    ),
    createGuard(fakes, options.currentUser),
    FIXED_CLOCK,
  );
  return { reader, fakes };
}

describe('DefaultUltrasPlanReader.offer', () => {
  test('機能フラグの値と月額の価格を返し、価格の古さは照会の結果のまま、ログインを確かめない', async () => {
    const { reader, fakes } = setup({ enabled: true });

    const offer = await reader.offer();

    expect(offer).toEqual({
      promotionEnabled: true,
      price: { amount: 999, currency: 'usd' },
      priceStale: false,
    });
    expect(fakes.priceLookups).toEqual([[ULTRAS_PRICE_LOOKUP_KEY]]);
    expect(fakes.calls).not.toContain('currentUser');
  });

  test('機能フラグがオフでも価格を返し、フラグの値だけを偽にする', async () => {
    const { reader } = setup({ enabled: false });

    const offer = await reader.offer();

    expect(offer).toEqual({
      promotionEnabled: false,
      price: { amount: 999, currency: 'usd' },
      priceStale: false,
    });
  });

  test('以前に照会した価格が返ったときは価格の古さを真にする', async () => {
    const { reader } = setup({
      prices: { prices: [OTHER_PRICE, MONTHLY_PRICE], stale: true },
    });

    const offer = await reader.offer();

    expect(offer).toEqual({
      promotionEnabled: true,
      price: { amount: 999, currency: 'usd' },
      priceStale: true,
    });
  });

  test('価格の照会がpayments_unavailableを投げたときだけ、価格を空にして古さを偽にし、フラグの値は返す', async () => {
    const { reader } = setup({ enabled: true, prices: PAYMENTS_UNAVAILABLE });

    const offer = await reader.offer();

    expect(offer).toEqual({
      promotionEnabled: true,
      price: null,
      priceStale: false,
    });
  });

  test('照会の結果にUltrasの月額の価格が無ければ、価格を空にして古さを偽にする', async () => {
    const { reader } = setup({
      prices: { prices: [OTHER_PRICE], stale: true },
    });

    const offer = await reader.offer();

    expect(offer).toEqual({
      promotionEnabled: true,
      price: null,
      priceStale: false,
    });
  });

  test('payments_unavailable以外のAppErrorは投げ直す', async () => {
    const other = new AppError({
      kind: 'unavailable',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。',
    });
    const { reader } = setup({ prices: other });

    expect(await rejectionOf(reader.offer())).toBe(other);
  });

  test('AppErrorでない例外は投げ直す', async () => {
    const failure = new TypeError('接続が切れました');
    const { reader } = setup({ prices: failure });

    expect(await rejectionOf(reader.offer())).toBe(failure);
  });
});

describe('DefaultUltrasPlanReader.viewer', () => {
  test('ログインしていなければnullを返し、加入状態を照会しない', async () => {
    const { reader, fakes } = setup({ currentUser: undefined });

    const viewer = await reader.viewer(SESSION);

    expect(viewer).toBeNull();
    expect(fakes.calls).toEqual(['currentUser']);
  });

  test('ログイン中は現在時刻での加入状態・特典の有無を返し、加入があればPortalを開ける', async () => {
    const { reader, fakes } = setup({
      currentUser: CURRENT_USER,
      plan: ACTIVE_PLAN,
      entitled: true,
    });

    const viewer = await reader.viewer(SESSION);

    expect(viewer).toEqual({
      plan: ACTIVE_PLAN,
      entitled: true,
      canOpenPortal: true,
    });
    expect(fakes.entitlementCalls).toEqual([
      { userId: USER_ID, at: NOW },
      { userId: USER_ID, at: NOW },
    ]);
  });

  test('加入したことが無ければ加入状態を空にし、特典が無くPortalを開けない', async () => {
    const { reader } = setup({
      currentUser: CURRENT_USER,
      plan: null,
      entitled: false,
    });

    const viewer = await reader.viewer(SESSION);

    expect(viewer).toEqual({
      plan: null,
      entitled: false,
      canOpenPortal: false,
    });
  });

  test('終了した加入は特典が無くてもPortalを開ける', async () => {
    const { reader } = setup({
      currentUser: CURRENT_USER,
      plan: ENDED_PLAN,
      entitled: false,
    });

    const viewer = await reader.viewer(SESSION);

    expect(viewer).toEqual({
      plan: ENDED_PLAN,
      entitled: false,
      canOpenPortal: true,
    });
  });

  test('機能フラグの値は加入状態の照会に影響しない', async () => {
    const { reader, fakes } = setup({
      enabled: false,
      currentUser: CURRENT_USER,
      plan: ACTIVE_PLAN,
      entitled: true,
    });

    const viewer = await reader.viewer(SESSION);

    expect(viewer?.entitled).toBe(true);
    expect(fakes.calls).not.toContain('isEnabled');
  });
});
