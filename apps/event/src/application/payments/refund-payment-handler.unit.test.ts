import { describe, expect, test } from 'bun:test';

import { decideOnFailure } from '../../../lib/core/messaging/retry-policy.ts';
import {
  type PurchaseRecord,
  type PurchaseStore,
  type RefundRequestRecord,
  type RefundStore,
  type StripeGateway,
  StripeNotFoundError,
  StripeRejectedError,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import type { RefundIncident } from './refund-incidents.ts';
import {
  MISSING_PAYMENT_INTENT_FAILURE_CODE,
  REFUND_PAYMENT_RETRY_POLICY,
  RefundPaymentHandler,
  refundIdempotencyKeyOf,
} from './refund-payment-handler.ts';

type StatusUpdate = Parameters<RefundStore['updateStatus']>[0];

interface Recorded {
  readonly calls: string[];
  readonly updates: StatusUpdate[];
  readonly incidents: RefundIncident[];
}

const REFUND_REQUEST_ID = '01JC0RF0000000000000000001';
const PURCHASE_ID = '01JC0PURCHASE0000000000001';
const PAYMENT_INTENT_ID = 'pi_test_unit_1';
const SUBSCRIPTION_ID = 'sub_test_unit_1';
const T0 = new Date('2026-11-01T00:00:00.000Z');

// 使わないメソッドを呼んだら失敗させ、処理が想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

function requestOf(
  overrides: Partial<RefundRequestRecord> = {},
): RefundRequestRecord {
  return {
    id: REFUND_REQUEST_ID,
    purchaseId: PURCHASE_ID,
    requestKey: 'reflection:purchase-1',
    amount: 1_000,
    reason: 'late',
    noticeStatus: 'pending',
    status: 'requested',
    stripeRefundId: null,
    failureCode: null,
    dispatchedAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function purchaseOf(overrides: Partial<PurchaseRecord> = {}): PurchaseRecord {
  return {
    id: PURCHASE_ID,
    userId: '01JC0USER0000000000000001',
    kind: 'payments_smoke',
    targetId: null,
    relatedId: null,
    exclusivityKey: null,
    stateToken: '01JC0TOKEN0000000000000001',
    priceLookupKey: 'payments_smoke_v1',
    stripePriceId: 'price_smoke',
    unitAmount: 1_000,
    quantity: 1,
    amountTotal: 1_000,
    summary: {
      itemName: '疎通確認',
      quantityLabel: '1件',
      serviceTiming: '決済の直後',
      additionalNotes: [],
    },
    deadlineAt: null,
    acceptUntil: null,
    fulfillableUntil: null,
    expiresAt: T0,
    status: 'rejected',
    rejectionReason: 'late',
    stripeCheckoutSessionId: 'cs_test_unit_1',
    stripePaymentIntentId: PAYMENT_INTENT_ID,
    stripeInvoiceId: null,
    stripeSubscriptionId: null,
    consentedAt: null,
    consentVersion: null,
    paidAt: T0,
    reflectedAt: T0,
    confirmationEmailStatus: 'none',
    lastEventAt: T0,
    createdAt: T0,
    ...overrides,
  };
}

function handlerWith(options: {
  readonly request?: RefundRequestRecord | undefined;
  readonly purchase?: PurchaseRecord | undefined;
  readonly gateway?: Partial<StripeGateway>;
  readonly updated?: boolean;
}): { readonly handler: RefundPaymentHandler } & Recorded {
  const calls: string[] = [];
  const updates: StatusUpdate[] = [];
  const incidents: RefundIncident[] = [];
  const refunds = partialFake<RefundStore>({
    findById: () =>
      Promise.resolve('request' in options ? options.request : requestOf()),
    updateStatus: (input) => {
      calls.push(`updateStatus:${input.status}`);
      updates.push(input);
      return Promise.resolve(options.updated ?? true);
    },
  });
  const purchases = partialFake<PurchaseStore>({
    findById: () =>
      Promise.resolve('purchase' in options ? options.purchase : purchaseOf()),
  });
  const gateway = partialFake<StripeGateway>({
    cancelSubscription: (...args) => {
      calls.push('cancelSubscription');
      return (
        options.gateway?.cancelSubscription ??
        (() => Promise.resolve('canceled' as const))
      )(...args);
    },
    createRefund: (input) => {
      calls.push('createRefund');
      return (
        options.gateway?.createRefund ??
        (() =>
          Promise.resolve({
            id: 're_test_unit_1',
            status: 'pending' as const,
            amount: input.amount ?? 0,
            currency: 'usd',
            paymentIntentId: input.paymentIntentId,
            failureReason: null,
            metadata: {},
          }))
      )(input);
    },
  });
  const handler = new RefundPaymentHandler(refunds, purchases, gateway, {
    report: (incident) => {
      calls.push(`report:${incident.kind}`);
      incidents.push(incident);
    },
  });
  return { handler, calls, updates, incidents };
}

function rejection(stripeErrorCode: string): StripeRejectedError {
  return new StripeRejectedError({
    message: 'Stripeが操作を拒否しました',
    stripeErrorCode,
  });
}

const BODY = { refundRequestId: REFUND_REQUEST_ID };

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('例外になりませんでした');
}

describe('REFUND_PAYMENT_RETRY_POLICY', () => {
  test('最大5回、60秒から倍の間隔で再試行し、5回目の失敗でデッドレターへ移す', () => {
    expect(
      [1, 2, 3, 4, 5].map((attempts) =>
        decideOnFailure(REFUND_PAYMENT_RETRY_POLICY, attempts),
      ),
    ).toEqual([
      { kind: 'retry', delaySeconds: 60 },
      { kind: 'retry', delaySeconds: 120 },
      { kind: 'retry', delaySeconds: 240 },
      { kind: 'retry', delaySeconds: 480 },
      { kind: 'dead-letter' },
    ]);
    expect(Object.isFrozen(REFUND_PAYMENT_RETRY_POLICY)).toBe(true);
  });
});

describe('refundIdempotencyKeyOf', () => {
  test('依頼キーにrefund:を前に付ける', () => {
    expect(refundIdempotencyKeyOf('tournament-week:entry-1')).toBe(
      'refund:tournament-week:entry-1',
    );
  });
});

describe('RefundPaymentHandlerの返金の作成', () => {
  test('依頼の金額・理由と購入のPaymentIntentのIDで返金を作り、依頼中のときだけ提出済みにする', async () => {
    let created: Parameters<StripeGateway['createRefund']>[0] | undefined;
    const { handler, calls, updates } = handlerWith({
      gateway: {
        createRefund: (input) => {
          created = input;
          return Promise.resolve({
            id: 're_test_unit_1',
            status: 'pending',
            amount: 1_000,
            currency: 'usd',
            paymentIntentId: PAYMENT_INTENT_ID,
            failureReason: null,
            metadata: {},
          });
        },
      },
    });

    expect(await handler.handle(BODY)).toEqual({ kind: 'done' });

    expect(calls).toEqual(['createRefund', 'updateStatus:submitted']);
    expect(updates).toEqual([
      {
        refundRequestId: REFUND_REQUEST_ID,
        status: 'submitted',
        stripeRefundId: 're_test_unit_1',
        from: ['requested'],
      },
    ]);
    expect(created).toEqual({
      paymentIntentId: PAYMENT_INTENT_ID,
      amount: 1_000,
      reason: 'requested_by_customer',
      refundRequestId: REFUND_REQUEST_ID,
      purchaseId: PURCHASE_ID,
      idempotencyKey: 'refund:reflection:purchase-1',
    });
  });

  test('拒否された定期課金の購入は、先に即時の解約を行う', async () => {
    const { handler, calls } = handlerWith({
      purchase: purchaseOf({ stripeSubscriptionId: SUBSCRIPTION_ID }),
    });

    await handler.handle(BODY);

    expect(calls).toEqual([
      'cancelSubscription',
      'createRefund',
      'updateStatus:submitted',
    ]);
  });

  test('支払いの確定した定期課金の購入では解約しない', async () => {
    const { handler, calls } = handlerWith({
      purchase: purchaseOf({
        status: 'fulfilled',
        rejectionReason: null,
        stripeSubscriptionId: SUBSCRIPTION_ID,
      }),
    });

    await handler.handle(BODY);

    expect(calls).toEqual(['createRefund', 'updateStatus:submitted']);
  });

  test('反映が先に依頼を進めていて提出済みにできなくても、成功として終える', async () => {
    const { handler, incidents } = handlerWith({ updated: false });

    expect(await handler.handle(BODY)).toEqual({ kind: 'done' });
    expect(incidents).toEqual([]);
  });
});

describe('RefundPaymentHandlerの無処理', () => {
  test.each(['submitted', 'succeeded', 'failed', 'canceled'] as const)(
    '%sの依頼はStripeも購入も読まずに終える',
    async (status) => {
      const { handler, calls } = handlerWith({
        request: requestOf({ status }),
        purchase: undefined,
      });

      expect(await handler.handle(BODY)).toEqual({ kind: 'done' });
      expect(calls).toEqual([]);
    },
  );

  test('依頼の行が無ければ何もせずに終える', async () => {
    const { handler, calls } = handlerWith({ request: undefined });

    expect(await handler.handle(BODY)).toEqual({ kind: 'done' });
    expect(calls).toEqual([]);
  });
});

describe('RefundPaymentHandlerの失敗', () => {
  test.each([
    ['購入が無い', undefined],
    [
      '購入にPaymentIntentのIDが無い',
      purchaseOf({ stripePaymentIntentId: null }),
    ],
  ] as const)(
    '%s依頼は、失敗を記録してから知らせる',
    async (_label, purchase) => {
      const { handler, calls, updates, incidents } = handlerWith({
        purchase,
      });

      await handler.handle(BODY);

      expect(calls).toEqual([
        'updateStatus:failed',
        'report:missing-payment-intent',
      ]);
      expect(updates).toEqual([
        {
          refundRequestId: REFUND_REQUEST_ID,
          status: 'failed',
          failureCode: MISSING_PAYMENT_INTENT_FAILURE_CODE,
          from: ['requested'],
        },
      ]);
      expect(incidents).toEqual([
        { kind: 'missing-payment-intent', refundRequestId: REFUND_REQUEST_ID },
      ]);
    },
  );

  test('失敗を記録できなかった(他の配信が先に進めた)ときは知らせない', async () => {
    const { handler, incidents } = handlerWith({
      purchase: undefined,
      updated: false,
    });

    await handler.handle(BODY);

    expect(incidents).toEqual([]);
  });

  test('返金の作成の恒久的な拒否は、拒否のコードで失敗を記録して知らせ、成功として終える', async () => {
    const { handler, updates, incidents } = handlerWith({
      gateway: {
        createRefund: () => Promise.reject(rejection('charge_disputed')),
      },
    });

    expect(await handler.handle(BODY)).toEqual({ kind: 'done' });
    expect(updates).toEqual([
      {
        refundRequestId: REFUND_REQUEST_ID,
        status: 'failed',
        failureCode: 'charge_disputed',
        from: ['requested'],
      },
    ]);
    expect(incidents).toEqual([
      {
        kind: 'stripe-rejected',
        refundRequestId: REFUND_REQUEST_ID,
        operation: 'create_refund',
        stripeErrorCode: 'charge_disputed',
      },
    ]);
  });

  test('Stripeに支払いが無いときは、resource_missingで失敗を記録して知らせる', async () => {
    const { handler, updates, incidents } = handlerWith({
      gateway: {
        createRefund: () =>
          Promise.reject(new StripeNotFoundError('Stripeに対象がありません')),
      },
    });

    await handler.handle(BODY);

    expect(updates.map(({ failureCode }) => failureCode)).toEqual([
      'resource_missing',
    ]);
    expect(incidents).toEqual([
      {
        kind: 'stripe-rejected',
        refundRequestId: REFUND_REQUEST_ID,
        operation: 'create_refund',
        stripeErrorCode: 'resource_missing',
      },
    ]);
  });

  test('定期課金の解約の恒久的な拒否は、返金を作らずに失敗を記録して知らせる', async () => {
    const { handler, calls, incidents } = handlerWith({
      purchase: purchaseOf({ stripeSubscriptionId: SUBSCRIPTION_ID }),
      gateway: {
        cancelSubscription: () =>
          Promise.reject(rejection('subscription_locked')),
      },
    });

    await handler.handle(BODY);

    expect(calls).toEqual([
      'cancelSubscription',
      'updateStatus:failed',
      'report:stripe-rejected',
    ]);
    expect(incidents).toEqual([
      {
        kind: 'stripe-rejected',
        refundRequestId: REFUND_REQUEST_ID,
        operation: 'cancel_subscription',
        stripeErrorCode: 'subscription_locked',
      },
    ]);
  });

  test.each([
    ['Stripeの一時的な失敗', new StripeUnavailableError('一時的な失敗')],
    ['想定外の失敗', new Error('想定外の失敗')],
  ] as const)(
    '%sは例外のまま投げ、依頼の状態を変えない',
    async (_label, error) => {
      const { handler, updates, incidents } = handlerWith({
        gateway: { createRefund: () => Promise.reject(error) },
      });

      expect(await rejectionOf(handler.handle(BODY))).toBe(error);
      expect(updates).toEqual([]);
      expect(incidents).toEqual([]);
    },
  );
});
