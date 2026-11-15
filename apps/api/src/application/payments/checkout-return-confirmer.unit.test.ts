import { describe, expect, test } from 'bun:test';
import { Container, type ServiceIdentifier } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import {
  type PurchaseRecord,
  type ReflectionOutcome,
  type StripeCheckoutSessionSnapshot,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import {
  CLIENT_SECRET,
  createAccountGuard,
  createSessionGateway,
  createSnapshotReflector,
  FIXED_CLOCK,
  InMemoryCheckoutPurchases,
  NOW,
  OTHER_USER_ID,
  PURCHASE_ID,
  purchaseRecordOf,
  SESSION,
  SESSION_ID,
  type SnapshotReflection,
  sessionSnapshotOf,
  UNAUTHENTICATED,
} from '../../../test/support/payments-checkout-fakes.ts';
import {
  type CheckoutReturnConfirmer,
  StripeCheckoutReturnConfirmer,
} from './checkout-return-confirmer.ts';
import { API_PAYMENTS_TYPES } from './payments-types.ts';

const PAID_SNAPSHOT = sessionSnapshotOf({
  status: 'complete',
  paymentStatus: 'paid',
  clientSecret: null,
  paymentIntentId: 'pi_test_paid',
  paymentIntentStatus: 'succeeded',
});

interface Options {
  readonly purchases?: readonly PurchaseRecord[];
  readonly guardError?: Error;
  readonly retrieve?: (
    sessionId: string,
  ) => Promise<StripeCheckoutSessionSnapshot>;
  // 反映の処理が購入に書き込む状態。省略すると書き込まない
  readonly reflectedAs?: Partial<PurchaseRecord>;
  readonly reflectError?: Error;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const reflections: SnapshotReflection[] = [];
  const retrieved: string[] = [];
  const purchases = new InMemoryCheckoutPurchases(
    calls,
    options.purchases ?? [purchaseRecordOf()],
  );
  const reflect = (): Promise<ReflectionOutcome> => {
    if (options.reflectError !== undefined) {
      return Promise.reject(options.reflectError);
    }
    const current = purchases.get(PURCHASE_ID);
    if (current === undefined || options.reflectedAs === undefined) {
      return Promise.resolve({ kind: 'already_applied' });
    }
    const alreadyApplied = current.status === options.reflectedAs.status;
    purchases.put({ ...current, ...options.reflectedAs });
    return Promise.resolve(
      alreadyApplied
        ? { kind: 'already_applied', purchaseStatus: current.status }
        : { kind: 'applied', purchaseStatus: options.reflectedAs.status },
    );
  };
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
    createSessionGateway(calls, (sessionId) => {
      retrieved.push(sessionId);
      return (options.retrieve ?? (() => Promise.resolve(PAID_SNAPSHOT)))(
        sessionId,
      );
    }),
  );
  bindConstant(
    PAYMENTS_TYPES.PaymentReflector,
    createSnapshotReflector(calls, reflections, reflect),
  );
  bindConstant(PLATFORM_TYPES.Clock, FIXED_CLOCK);
  container
    .bind<CheckoutReturnConfirmer>(API_PAYMENTS_TYPES.CheckoutReturnConfirmer)
    .to(StripeCheckoutReturnConfirmer);
  return {
    confirmer: container.get<CheckoutReturnConfirmer>(
      API_PAYMENTS_TYPES.CheckoutReturnConfirmer,
    ),
    calls,
    reflections,
    retrieved,
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

describe('StripeCheckoutReturnConfirmer', () => {
  test('本人の決済セッションをStripeから取得し、Webhookと同じ反映の処理を呼んで、反映後の購入を返す', async () => {
    const { confirmer, calls, reflections, retrieved } = setup({
      reflectedAs: { status: 'fulfilled', paidAt: NOW, reflectedAt: NOW },
    });

    const result = await confirmer.confirm(SESSION, SESSION_ID);

    expect(retrieved).toEqual([SESSION_ID]);
    expect(reflections).toEqual([{ snapshot: PAID_SNAPSHOT, occurredAt: NOW }]);
    expect({
      purchaseId: result.checkout.purchaseId,
      status: result.checkout.status,
      clientSecret: result.checkout.clientSecret,
      canRestart: result.checkout.canRestart,
    }).toEqual({
      purchaseId: PURCHASE_ID,
      status: 'completed',
      clientSecret: null,
      canRestart: false,
    });
    expect(calls).toEqual([
      'requireUser',
      'findBySessionId',
      'retrieveCheckoutSession',
      'reflectCheckoutSnapshot',
      'findById',
    ]);
  });

  test('同じ決済セッションを2回確かめても、2回目は反映済みとなり同じ結果を返す', async () => {
    const { confirmer, reflections } = setup({
      reflectedAs: { status: 'fulfilled' },
    });

    const first = await confirmer.confirm(SESSION, SESSION_ID);
    const second = await confirmer.confirm(SESSION, SESSION_ID);

    expect(second).toEqual(first);
    expect(reflections).toHaveLength(2);
  });

  test.each([
    [
      '未払いの完了で処理中になった購入',
      { status: 'processing' },
      'processing',
    ],
    [
      '権利を付与できず拒否された購入',
      { status: 'rejected', rejectionReason: 'ineligible' },
      'refunding',
    ],
    ['失効した購入', { status: 'expired' }, 'expired'],
  ] as const)('%sを%sとして返す', async (_label, reflectedAs, expected) => {
    const { confirmer } = setup({ reflectedAs });

    const { checkout } = await confirmer.confirm(SESSION, SESSION_ID);

    expect(checkout.status).toBe(expected);
  });

  test('権利を付与できなかった購入は拒否の理由を返す', async () => {
    const { confirmer } = setup({
      reflectedAs: { status: 'rejected', rejectionReason: 'duplicate' },
    });

    const { checkout } = await confirmer.confirm(SESSION, SESSION_ID);

    expect(checkout.rejectionReason).toBe('duplicate');
  });

  test('失効した購入は受付期限の前ならやり直せる旨を返す', async () => {
    const { confirmer } = setup({
      retrieve: () =>
        Promise.resolve(
          sessionSnapshotOf({ status: 'expired', clientSecret: null }),
        ),
      reflectedAs: { status: 'expired' },
    });

    const { checkout } = await confirmer.confirm(SESSION, SESSION_ID);

    expect({
      status: checkout.status,
      canRestart: checkout.canRestart,
    }).toEqual({ status: 'expired', canRestart: true });
  });

  test('支払わずに戻った未完了の決済セッションは、未完了のままclientSecretを返す', async () => {
    const { confirmer } = setup({
      retrieve: () => Promise.resolve(sessionSnapshotOf()),
    });

    const { checkout } = await confirmer.confirm(SESSION, SESSION_ID);

    expect({
      status: checkout.status,
      clientSecret: checkout.clientSecret,
    }).toEqual({ status: 'open', clientSecret: CLIENT_SECRET });
  });

  test('Stripeに到達できなければ反映せずに処理中を返し、画面の確かめ直しに任せる', async () => {
    const { confirmer, reflections } = setup({
      retrieve: () => Promise.reject(new StripeUnavailableError('timeout')),
    });

    const { checkout } = await confirmer.confirm(SESSION, SESSION_ID);

    expect(checkout.status).toBe('processing');
    expect(checkout.clientSecret).toBeNull();
    expect(reflections).toEqual([]);
  });

  test('反映の途中でStripeに到達できなくなっても処理中を返す', async () => {
    const { confirmer } = setup({
      reflectError: new StripeUnavailableError('timeout'),
    });

    const { checkout } = await confirmer.confirm(SESSION, SESSION_ID);

    expect(checkout.status).toBe('processing');
  });

  test('Stripeに到達できなくても、Webhookで既に完了した購入は完了として返す', async () => {
    const { confirmer } = setup({
      purchases: [purchaseRecordOf({ status: 'fulfilled' })],
      retrieve: () => Promise.reject(new StripeUnavailableError('timeout')),
    });

    const { checkout } = await confirmer.confirm(SESSION, SESSION_ID);

    expect(checkout.status).toBe('completed');
  });

  test('反映の一時的でない失敗はそのまま返す', async () => {
    const failure = new Error('D1の一括の書き込みに失敗しました');
    const { confirmer } = setup({ reflectError: failure });

    expect(await rejectionOf(confirmer.confirm(SESSION, SESSION_ID))).toBe(
      failure,
    );
  });

  test.each([
    [
      '他人の購入の決済セッション',
      [purchaseRecordOf({ userId: OTHER_USER_ID })],
    ],
    ['本サービスの購入に結び付かない決済セッション', []],
  ] as const)(
    '%sは、Stripeを呼ばず反映もせずに見つからない旨だけを返す',
    async (_label, purchases) => {
      const { confirmer, calls } = setup({
        purchases,
        reflectedAs: { status: 'fulfilled' },
      });

      expectCheckoutNotFound(
        await rejectionOf(confirmer.confirm(SESSION, SESSION_ID)),
      );
      expect(calls).toEqual(['requireUser', 'findBySessionId']);
    },
  );

  test.each([
    ['空の値', ''],
    ['決済セッション以外のID', 'pi_test_a1B2c3D4'],
    ['256文字のID', `cs_${'a'.repeat(253)}`],
    ['記号を含むID', 'cs_test_../a1B2'],
  ])(
    '%sは、購入を探さずに決済セッションのIDの欄の入力の検証のエラーにする',
    async (_label, sessionId) => {
      const { confirmer, calls } = setup();

      const error = await rejectionOf(confirmer.confirm(SESSION, sessionId));

      expect(error).toBeInstanceOf(AppError);
      expect({
        kind: (error as AppError).kind,
        code: (error as AppError).code,
        details: (error as AppError).details,
      }).toEqual({
        kind: 'bad_request',
        code: 'validation_error',
        details: [
          {
            field: 'sessionId',
            code: 'invalid',
            message: '決済の確認に必要な情報が正しくありません。',
          },
        ],
      });
      expect(calls).toEqual(['requireUser']);
    },
  );

  test('ログインしていなければ購入を探さずに拒否する', async () => {
    const { confirmer, calls } = setup({ guardError: UNAUTHENTICATED });

    expect(await rejectionOf(confirmer.confirm(SESSION, SESSION_ID))).toBe(
      UNAUTHENTICATED,
    );
    expect(calls).toEqual(['requireUser']);
  });
});
