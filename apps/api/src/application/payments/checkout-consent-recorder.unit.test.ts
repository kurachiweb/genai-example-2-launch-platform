import { describe, expect, test } from 'bun:test';
import { Container, type ServiceIdentifier } from 'inversify';

import { CHECKOUT_CONSENT_VERSION } from '../../../common-lib/payments/checkout-consent.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type {
  PurchaseRecord,
  PurchaseStore,
} from '../../../lib/core/payments/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  ACCOUNT_UNAVAILABLE,
  CLIENT_SECRET,
  createAccountGuard,
  createSessionGateway,
  InMemoryCheckoutPurchases,
  NOW,
  OTHER_USER_ID,
  PURCHASE_ID,
  purchaseRecordOf,
  SESSION,
  sessionSnapshotOf,
  UNAUTHENTICATED,
  USER_ID,
} from '../../../test/support/payments-checkout-fakes.ts';
import {
  type CheckoutConsentRecorder,
  StoreCheckoutConsentRecorder,
} from './checkout-consent-recorder.ts';
import {
  type CheckoutReader,
  StripeCheckoutReader,
} from './checkout-reader.ts';
import { API_PAYMENTS_TYPES } from './payments-types.ts';

interface Options {
  readonly purchases?: readonly PurchaseRecord[];
  readonly guardError?: Error;
  readonly writableError?: Error;
  // 読み出しの直後に反映が購入を進める競合を再現する
  readonly settleAfterRead?: Partial<PurchaseRecord>;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const purchases = new InMemoryCheckoutPurchases(
    calls,
    options.purchases ?? [purchaseRecordOf()],
  );
  const store = purchases.store();
  const { settleAfterRead } = options;
  const racingStore: PurchaseStore =
    settleAfterRead === undefined
      ? store
      : {
          ...store,
          findById: async (purchaseId) => {
            const found = await store.findById(purchaseId);
            if (found !== undefined) {
              purchases.put({ ...found, ...settleAfterRead });
            }
            return found;
          },
        };
  let now = NOW;
  const clock: Clock = { now: () => now };
  const container = new Container();
  const bindConstant = <T>(identifier: ServiceIdentifier<T>, value: T) => {
    container.bind<T>(identifier).toConstantValue(value);
  };
  bindConstant(
    IDENTITY_PLATFORM_TYPES.AccountGuard,
    createAccountGuard(calls, options.guardError, options.writableError),
  );
  bindConstant(PAYMENTS_TYPES.PurchaseStore, racingStore);
  bindConstant(
    PAYMENTS_TYPES.StripeGateway,
    createSessionGateway(calls, () => Promise.resolve(sessionSnapshotOf())),
  );
  bindConstant(PLATFORM_TYPES.Clock, clock);
  container
    .bind<CheckoutReader>(API_PAYMENTS_TYPES.CheckoutReader)
    .to(StripeCheckoutReader);
  container
    .bind<CheckoutConsentRecorder>(API_PAYMENTS_TYPES.CheckoutConsentRecorder)
    .to(StoreCheckoutConsentRecorder);
  return {
    recorder: container.get<CheckoutConsentRecorder>(
      API_PAYMENTS_TYPES.CheckoutConsentRecorder,
    ),
    purchases,
    calls,
    advanceTo: (at: Date) => {
      now = at;
    },
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('拒否されませんでした');
}

function expectAppError(
  error: unknown,
  expected: {
    readonly kind: AppErrorKind;
    readonly code: string;
    readonly message: string;
  },
): void {
  expect(error).toBeInstanceOf(AppError);
  expect({
    kind: (error as AppError).kind,
    code: (error as AppError).code,
    message: (error as AppError).message,
  }).toEqual(expected);
}

const NOT_FOUND = Object.freeze({
  kind: 'not_found',
  code: 'checkout_not_found',
  message: 'お探しの決済は見つかりませんでした。',
} as const);

const NOT_OPEN = Object.freeze({
  kind: 'conflict',
  code: 'checkout_not_open',
  message: 'この決済は既に完了しているか、受付が終了しています。',
} as const);

describe('StoreCheckoutConsentRecorder', () => {
  test('本人の未完了の購入に同意の日時と現在の文言の版を記録し、決済画面の情報を返す', async () => {
    const { recorder, purchases, calls } = setup();

    const view = await recorder.record(SESSION, PURCHASE_ID);

    expect(purchases.consentCalls).toEqual([
      {
        purchaseId: PURCHASE_ID,
        userId: USER_ID,
        consentedAt: NOW,
        version: CHECKOUT_CONSENT_VERSION,
      },
    ]);
    expect(purchases.get(PURCHASE_ID)).toMatchObject({
      consentedAt: NOW,
      consentVersion: CHECKOUT_CONSENT_VERSION,
    });
    expect({
      purchaseId: view.purchaseId,
      status: view.status,
      clientSecret: view.clientSecret,
    }).toEqual({
      purchaseId: PURCHASE_ID,
      status: 'open',
      clientSecret: CLIENT_SECRET,
    });
    expect(calls.slice(0, 3)).toEqual([
      'requireWritableUser',
      'findById',
      'recordConsent',
    ]);
  });

  test('同じ購入の再記録は最新の日時で上書きする', async () => {
    const { recorder, purchases, advanceTo } = setup();
    const later = new Date(NOW.getTime() + 60_000);

    await recorder.record(SESSION, PURCHASE_ID);
    advanceTo(later);
    await recorder.record(SESSION, PURCHASE_ID);

    expect(
      purchases.consentCalls.map(({ consentedAt }) => consentedAt),
    ).toEqual([NOW, later]);
    expect(purchases.get(PURCHASE_ID)?.consentedAt).toEqual(later);
  });

  test.each([
    ['他人の購入', [purchaseRecordOf({ userId: OTHER_USER_ID })]],
    ['存在しない購入', []],
  ] as const)(
    '%sは状態を明かさずに見つからない旨を返し、同意を記録しない',
    async (_label, list) => {
      const { recorder, purchases } = setup({ purchases: list });

      expectAppError(
        await rejectionOf(recorder.record(SESSION, PURCHASE_ID)),
        NOT_FOUND,
      );
      expect(purchases.consentCalls).toEqual([]);
    },
  );

  test('他人の完了した購入でも、受付の終了ではなく見つからない旨を返す', async () => {
    const { recorder } = setup({
      purchases: [
        purchaseRecordOf({ userId: OTHER_USER_ID, status: 'fulfilled' }),
      ],
    });

    expectAppError(
      await rejectionOf(recorder.record(SESSION, PURCHASE_ID)),
      NOT_FOUND,
    );
  });

  test.each([
    'processing',
    'fulfilled',
    'rejected',
    'expired',
    'superseded',
  ] as const)('%sの購入には同意を記録せずに拒否する', async (status) => {
    const { recorder, purchases } = setup({
      purchases: [purchaseRecordOf({ status })],
    });

    expectAppError(
      await rejectionOf(recorder.record(SESSION, PURCHASE_ID)),
      NOT_OPEN,
    );
    expect(purchases.consentCalls).toEqual([]);
  });

  test('有効期限を過ぎた未完了の購入には同意を記録せずに拒否する', async () => {
    const { recorder, purchases } = setup({
      purchases: [purchaseRecordOf({ expiresAt: NOW })],
    });

    expectAppError(
      await rejectionOf(recorder.record(SESSION, PURCHASE_ID)),
      NOT_OPEN,
    );
    expect(purchases.consentCalls).toEqual([]);
  });

  test('読んだ後に反映が購入を完了させて記録できなければ、受付の終了として拒否する', async () => {
    const { recorder, purchases } = setup({
      settleAfterRead: { status: 'fulfilled' },
    });

    expectAppError(
      await rejectionOf(recorder.record(SESSION, PURCHASE_ID)),
      NOT_OPEN,
    );
    expect(purchases.consentCalls).toHaveLength(1);
    expect(purchases.get(PURCHASE_ID)?.consentedAt).toBeNull();
  });

  test('停止中の利用者の同意の記録を拒否し、購入に書き込まない', async () => {
    const { recorder, calls, purchases } = setup({
      writableError: ACCOUNT_UNAVAILABLE,
    });

    expect(await rejectionOf(recorder.record(SESSION, PURCHASE_ID))).toBe(
      ACCOUNT_UNAVAILABLE,
    );
    expect(calls).toEqual(['requireWritableUser']);
    expect(purchases.consentCalls).toEqual([]);
    expect(purchases.get(PURCHASE_ID)?.consentedAt).toBeNull();
  });

  test('ログインしていなければ購入を読まずに拒否する', async () => {
    const { recorder, calls, purchases } = setup({
      guardError: UNAUTHENTICATED,
    });

    expect(await rejectionOf(recorder.record(SESSION, PURCHASE_ID))).toBe(
      UNAUTHENTICATED,
    );
    expect(calls).toEqual(['requireWritableUser']);
    expect(purchases.consentCalls).toEqual([]);
  });
});
