import { describe, expect, test } from 'bun:test';
import { Container, type ServiceIdentifier } from 'inversify';

import { CHECKOUT_CONSENT_VERSION } from '../../../common-lib/payments/checkout-consent.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import {
  type PurchaseRecord,
  type StripeCheckoutSessionSnapshot,
  StripeRejectedError,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import {
  CLIENT_SECRET,
  createAccountGuard,
  createSessionGateway,
  FIXED_CLOCK,
  HOUR_MS,
  InMemoryCheckoutPurchases,
  NOW,
  OTHER_USER_ID,
  PURCHASE_ID,
  purchaseRecordOf,
  SESSION,
  SESSION_ID,
  sessionSnapshotOf,
  UNAUTHENTICATED,
} from '../../../test/support/payments-checkout-fakes.ts';
import {
  type CheckoutReader,
  StripeCheckoutReader,
} from './checkout-reader.ts';
import { API_PAYMENTS_TYPES } from './payments-types.ts';

interface Options {
  readonly purchases?: readonly PurchaseRecord[];
  readonly guardError?: Error;
  readonly retrieve?: (
    sessionId: string,
  ) => Promise<StripeCheckoutSessionSnapshot>;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const purchases = new InMemoryCheckoutPurchases(
    calls,
    options.purchases ?? [purchaseRecordOf()],
  );
  const container = new Container();
  const bindConstant = <T>(identifier: ServiceIdentifier<T>, value: T) => {
    container.bind<T>(identifier).toConstantValue(value);
  };
  bindConstant(
    IDENTITY_PLATFORM_TYPES.AccountGuard,
    createAccountGuard(calls, options.guardError),
  );
  bindConstant(PAYMENTS_TYPES.PurchaseStore, purchases.store());
  bindConstant(
    PAYMENTS_TYPES.StripeGateway,
    createSessionGateway(
      calls,
      options.retrieve ?? (() => Promise.resolve(sessionSnapshotOf())),
    ),
  );
  bindConstant(PLATFORM_TYPES.Clock, FIXED_CLOCK);
  container
    .bind<CheckoutReader>(API_PAYMENTS_TYPES.CheckoutReader)
    .to(StripeCheckoutReader);
  return {
    reader: container.get<CheckoutReader>(API_PAYMENTS_TYPES.CheckoutReader),
    calls,
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

function expectCheckoutNotFound(error: unknown): void {
  expect(error).toBeInstanceOf(AppError);
  expect({
    kind: (error as AppError).kind,
    code: (error as AppError).code,
    message: (error as AppError).message,
  }).toEqual({
    kind: 'not_found',
    code: 'checkout_not_found',
    message: 'お探しの決済は見つかりませんでした。',
  });
}

describe('StripeCheckoutReader', () => {
  test('本人の未完了の購入の表示事項と、決済セッションのclientSecretを返す', async () => {
    const { reader, calls } = setup();
    const purchase = purchaseRecordOf();

    const view = await reader.read(SESSION, PURCHASE_ID);

    expect(view).toEqual({
      purchaseId: PURCHASE_ID,
      kind: 'week_tournament_entry',
      status: 'open',
      rejectionReason: null,
      clientSecret: CLIENT_SECRET,
      unitPrice: { amount: 500, currency: 'usd' },
      quantity: 3,
      total: { amount: 1500, currency: 'usd' },
      summary: {
        itemName: 'Weekトーナメント参加費',
        quantityLabel: '3日間',
        serviceTiming: '決済の直後',
        additionalNotes: ['決勝の結果は翌週に通知します。'],
        isSubscription: false,
      },
      acceptUntil: purchase.acceptUntil,
      expiresAt: purchase.expiresAt,
      consentVersion: CHECKOUT_CONSENT_VERSION,
      canRestart: false,
    });
    expect(calls).toEqual([
      'requireUser',
      'findById',
      'retrieveCheckoutSession',
    ]);
  });

  test('Ultrasの購入を定期課金として示す', async () => {
    const { reader } = setup({
      purchases: [purchaseRecordOf({ kind: 'ultras', quantity: 1 })],
    });

    const view = await reader.read(SESSION, PURCHASE_ID);

    expect(view.summary.isSubscription).toBe(true);
  });

  test('保存した決済セッションのIDでStripeから取得する', async () => {
    const retrieved: string[] = [];
    const { reader } = setup({
      retrieve: (sessionId) => {
        retrieved.push(sessionId);
        return Promise.resolve(sessionSnapshotOf());
      },
    });

    await reader.read(SESSION, PURCHASE_ID);

    expect(retrieved).toEqual([SESSION_ID]);
  });

  test.each([
    ['他人の購入', [purchaseRecordOf({ userId: OTHER_USER_ID })]],
    ['存在しない購入', []],
  ] as const)(
    '%sは状態を明かさずに見つからない旨だけを返し、Stripeを呼ばない',
    async (_label, purchases) => {
      const { reader, calls } = setup({ purchases });

      const error = await rejectionOf(reader.read(SESSION, PURCHASE_ID));

      expectCheckoutNotFound(error);
      expect(calls).not.toContain('retrieveCheckoutSession');
    },
  );

  test('他人の完了した購入でも、見つからない旨だけを返す', async () => {
    const { reader } = setup({
      purchases: [
        purchaseRecordOf({ userId: OTHER_USER_ID, status: 'fulfilled' }),
      ],
    });

    expectCheckoutNotFound(
      await rejectionOf(reader.read(SESSION, PURCHASE_ID)),
    );
  });

  test('ログインしていなければ購入を読まずに拒否する', async () => {
    const { reader, calls } = setup({ guardError: UNAUTHENTICATED });

    expect(await rejectionOf(reader.read(SESSION, PURCHASE_ID))).toBe(
      UNAUTHENTICATED,
    );
    expect(calls).toEqual(['requireUser']);
  });

  test.each([
    ['processing', 'processing'],
    ['fulfilled', 'completed'],
    ['rejected', 'refunding'],
    ['expired', 'expired'],
    ['superseded', 'expired'],
  ] as const)(
    '%sの購入を%sとして、Stripeを呼ばずにclientSecret無しで返す',
    async (status, expected) => {
      const { reader, calls } = setup({
        purchases: [
          purchaseRecordOf({
            status,
            rejectionReason: status === 'rejected' ? 'late' : null,
          }),
        ],
      });

      const view = await reader.read(SESSION, PURCHASE_ID);

      expect(view.status).toBe(expected);
      expect(view.clientSecret).toBeNull();
      expect(calls).not.toContain('retrieveCheckoutSession');
    },
  );

  test.each(['late', 'ineligible', 'duplicate'] as const)(
    '返金中の購入は拒否の理由%sを返す',
    async (reason) => {
      const { reader } = setup({
        purchases: [
          purchaseRecordOf({ status: 'rejected', rejectionReason: reason }),
        ],
      });

      const view = await reader.read(SESSION, PURCHASE_ID);

      expect({
        status: view.status,
        rejectionReason: view.rejectionReason,
      }).toEqual({ status: 'refunding', rejectionReason: reason });
    },
  );

  test('有効期限を過ぎた未完了の購入は、Stripeを呼ばずに失効として返す', async () => {
    const { reader, calls } = setup({
      purchases: [purchaseRecordOf({ expiresAt: NOW })],
    });

    const view = await reader.read(SESSION, PURCHASE_ID);

    expect(view.status).toBe('expired');
    expect(view.clientSecret).toBeNull();
    expect(calls).not.toContain('retrieveCheckoutSession');
  });

  test('Stripeに到達できなければ、clientSecret無しで利用できない状態を返す', async () => {
    const { reader } = setup({
      retrieve: () => Promise.reject(new StripeUnavailableError('timeout')),
    });

    const view = await reader.read(SESSION, PURCHASE_ID);

    expect(view.status).toBe('unavailable');
    expect(view.clientSecret).toBeNull();
    expect(view.canRestart).toBe(false);
  });

  test('決済セッションのIDがまだ無い未完了の購入は、Stripeを呼ばずに利用できない状態を返す', async () => {
    const { reader, calls } = setup({
      purchases: [purchaseRecordOf({ stripeCheckoutSessionId: null })],
    });

    const view = await reader.read(SESSION, PURCHASE_ID);

    expect(view.status).toBe('unavailable');
    expect(calls).not.toContain('retrieveCheckoutSession');
  });

  test('Stripeの恒久的な拒否は想定外の失敗としてそのまま返す', async () => {
    const rejected = new StripeRejectedError({
      message: 'invalid',
      stripeErrorCode: 'parameter_invalid',
    });
    const { reader } = setup({ retrieve: () => Promise.reject(rejected) });

    expect(await rejectionOf(reader.read(SESSION, PURCHASE_ID))).toBe(rejected);
  });

  test.each([
    [
      '完了した決済セッションは反映を待つ処理中',
      { status: 'complete' },
      'processing',
    ],
    [
      'Stripe上で失効した決済セッションは失効',
      { status: 'expired' },
      'expired',
    ],
    [
      'clientSecretの無い決済セッションは利用できない状態',
      { clientSecret: null },
      'unavailable',
    ],
  ] as const)('%sとして返す', async (_label, overrides, expected) => {
    const { reader } = setup({
      retrieve: () => Promise.resolve(sessionSnapshotOf(overrides)),
    });

    const view = await reader.read(SESSION, PURCHASE_ID);

    expect(view.status).toBe(expected);
    expect(view.clientSecret).toBeNull();
  });

  describe('やり直しの可否', () => {
    test.each([
      ['失効', 'expired'],
      ['置き換え済み', 'superseded'],
    ] as const)(
      '%sの購入は受付期限の前ならやり直せる',
      async (_label, status) => {
        const { reader } = setup({ purchases: [purchaseRecordOf({ status })] });

        expect((await reader.read(SESSION, PURCHASE_ID)).canRestart).toBe(true);
      },
    );

    test('受付期限ちょうど以降の失効した購入はやり直せない', async () => {
      const { reader } = setup({
        purchases: [purchaseRecordOf({ status: 'expired', acceptUntil: NOW })],
      });

      expect((await reader.read(SESSION, PURCHASE_ID)).canRestart).toBe(false);
    });

    test('受付期限の無い失効した購入は常にやり直せる', async () => {
      const { reader } = setup({
        purchases: [
          purchaseRecordOf({
            status: 'expired',
            deadlineAt: null,
            acceptUntil: null,
            fulfillableUntil: null,
            expiresAt: new Date(NOW.getTime() - 48 * HOUR_MS),
          }),
        ],
      });

      expect((await reader.read(SESSION, PURCHASE_ID)).canRestart).toBe(true);
    });

    test('有効期限を過ぎた未完了の購入も受付期限の前ならやり直せる', async () => {
      const { reader } = setup({
        purchases: [purchaseRecordOf({ expiresAt: NOW })],
      });

      expect((await reader.read(SESSION, PURCHASE_ID)).canRestart).toBe(true);
    });

    test.each(['processing', 'fulfilled', 'rejected'] as const)(
      '%sの購入はやり直せない',
      async (status) => {
        const { reader } = setup({ purchases: [purchaseRecordOf({ status })] });

        expect((await reader.read(SESSION, PURCHASE_ID)).canRestart).toBe(
          false,
        );
      },
    );
  });
});
