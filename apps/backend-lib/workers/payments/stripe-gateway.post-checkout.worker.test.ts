import { describe, expect, test } from 'vitest';

import {
  type StripeGateway,
  StripeNotFoundError,
  StripeRejectedError,
  StripeUnavailableError,
} from '../../core/payments/ports.ts';
import {
  createFakeStripe,
  FAKE_CLIENT_SITE_ORIGIN,
  FAKE_PSEUDONYMOUS_ID,
  FAKE_PURCHASE_ID,
  gatewayWith,
  type StripeCall,
  stripeError,
  stripeJson,
} from './testing/fake-stripe.ts';

const CANCEL_AT_SECONDS = 1_796_558_400;
const PERIOD_END_SECONDS = 1_796_558_400;
const ENDED_AT_SECONDS = 1_793_966_400;
const REFUND_REQUEST_ID = '01JBQ6Z8Y3V4W5X6Y7Z8A9B0C3';

const PURCHASE_METADATA = {
  purchase_id: FAKE_PURCHASE_ID,
  purchase_kind: 'ultras',
  pseudonymous_id: FAKE_PSEUDONYMOUS_ID,
};

function list(data: readonly unknown[]): Record<string, unknown> {
  return { object: 'list', has_more: false, data };
}

function invoiceObject(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'in_test_1',
    object: 'invoice',
    status: 'paid',
    amount_paid: 500,
    amount_due: 500,
    currency: 'usd',
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        subscription: 'sub_test_1',
        metadata: PURCHASE_METADATA,
      },
    },
    payments: list([
      {
        id: 'inpay_old',
        object: 'invoice_payment',
        is_default: false,
        payment: { type: 'payment_intent', payment_intent: 'pi_old' },
      },
      {
        id: 'inpay_1',
        object: 'invoice_payment',
        is_default: true,
        payment: { type: 'payment_intent', payment_intent: 'pi_sub_1' },
      },
    ]),
    ...overrides,
  };
}

function refundObject(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 're_test_1',
    object: 'refund',
    status: 'succeeded',
    amount: 4900,
    currency: 'usd',
    payment_intent: 'pi_test_1',
    metadata: {
      refund_request_id: REFUND_REQUEST_ID,
      purchase_id: FAKE_PURCHASE_ID,
    },
    ...overrides,
  };
}

function disputeObject(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'dp_test_1',
    object: 'dispute',
    status: 'needs_response',
    amount: 4900,
    currency: 'usd',
    charge: 'ch_test_1',
    payment_intent: 'pi_test_1',
    balance_transactions: [
      {
        id: 'txn_withdrawn',
        object: 'balance_transaction',
        amount: -4900,
        fee: 1500,
        net: -6400,
      },
    ],
    ...overrides,
  };
}

function subscriptionObject(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'sub_test_1',
    object: 'subscription',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    ended_at: null,
    customer: 'cus_test_1',
    metadata: PURCHASE_METADATA,
    items: list([
      {
        id: 'si_test_1',
        object: 'subscription_item',
        current_period_end: PERIOD_END_SECONDS,
      },
    ]),
    ...overrides,
  };
}

type RefundInput = Parameters<StripeGateway['createRefund']>[0];

function refundInput(overrides: Partial<RefundInput> = {}): RefundInput {
  return {
    paymentIntentId: 'pi_test_1',
    amount: 1200,
    reason: 'requested_by_customer',
    refundRequestId: REFUND_REQUEST_ID,
    purchaseId: FAKE_PURCHASE_ID,
    idempotencyKey: 'refund:late:01JBQ6Z8Y3V4W5X6Y7Z8A9B0C2',
    ...overrides,
  };
}

function callTo(calls: readonly StripeCall[], path: string): StripeCall {
  const found = calls.find((call) => call.path === path);
  if (found === undefined) {
    throw new Error(`${path}への要求がありません`);
  }
  return found;
}

describe('StripeApiGateway(請求の取得)', () => {
  test('支払いを展開して取得し、既定の支払いのPaymentIntentと定期課金のメタデータを返す', async () => {
    const fake = createFakeStripe(() => stripeJson(invoiceObject()));

    const snapshot = await gatewayWith(fake, 'event').retrieveInvoice(
      'in_test_1',
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('GET');
    expect(fake.calls[0]?.path).toBe('/v1/invoices/in_test_1');
    expect(fake.calls[0]?.query.get('expand[0]')).toBe('payments');
    expect(snapshot).toStrictEqual({
      id: 'in_test_1',
      status: 'paid',
      amountPaid: 500,
      amountDue: 500,
      currency: 'usd',
      paymentIntentId: 'pi_sub_1',
      subscriptionId: 'sub_test_1',
      subscriptionMetadata: PURCHASE_METADATA,
    });
  });

  test('定期課金の請求でなく支払いも無ければ、PaymentIntentと定期課金をnull、メタデータを空にする', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(
        invoiceObject({
          status: 'open',
          amount_paid: 0,
          parent: null,
          payments: list([]),
        }),
      ),
    );

    const snapshot = await gatewayWith(fake).retrieveInvoice('in_test_1');

    expect(snapshot).toMatchObject({
      status: 'open',
      amountPaid: 0,
      paymentIntentId: null,
      subscriptionId: null,
      subscriptionMetadata: {},
    });
  });

  test('想定外の状態の値は例外にする', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(invoiceObject({ status: 'archived' })),
    );

    await expect(
      gatewayWith(fake).retrieveInvoice('in_test_1'),
    ).rejects.toThrow('status');
  });
});

describe('StripeApiGateway(返金の取得)', () => {
  test('返金の状態・金額・PaymentIntent・メタデータを返す', async () => {
    const fake = createFakeStripe(() => stripeJson(refundObject()));

    const snapshot = await gatewayWith(fake).retrieveRefund('re_test_1');

    expect(fake.calls[0]?.method).toBe('GET');
    expect(fake.calls[0]?.path).toBe('/v1/refunds/re_test_1');
    expect(snapshot).toStrictEqual({
      id: 're_test_1',
      status: 'succeeded',
      amount: 4900,
      currency: 'usd',
      paymentIntentId: 'pi_test_1',
      failureReason: null,
      metadata: {
        refund_request_id: REFUND_REQUEST_ID,
        purchase_id: FAKE_PURCHASE_ID,
      },
    });
  });

  test('失敗した返金は失敗の理由を返し、メタデータが無ければ空にする', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(
        refundObject({
          status: 'failed',
          failure_reason: 'expired_or_canceled_card',
          payment_intent: { id: 'pi_test_2', object: 'payment_intent' },
          metadata: null,
        }),
      ),
    );

    const snapshot = await gatewayWith(fake).retrieveRefund('re_test_1');

    expect(snapshot).toMatchObject({
      status: 'failed',
      paymentIntentId: 'pi_test_2',
      failureReason: 'expired_or_canceled_card',
      metadata: {},
    });
  });

  test('想定外の状態の値は例外にする', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(refundObject({ status: null })),
    );

    await expect(gatewayWith(fake).retrieveRefund('re_test_1')).rejects.toThrow(
      'status',
    );
  });
});

describe('StripeApiGateway(チャージバックの取得)', () => {
  test('状態・金額・PaymentIntentと、手数料を含めない符号付きの資金の移動を返す', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(
        disputeObject({
          status: 'won',
          balance_transactions: [
            {
              id: 'txn_withdrawn',
              object: 'balance_transaction',
              amount: -4900,
              fee: 1500,
              net: -6400,
            },
            {
              id: 'txn_reinstated',
              object: 'balance_transaction',
              amount: 4900,
              fee: -1500,
              net: 6400,
            },
          ],
        }),
      ),
    );

    const snapshot = await gatewayWith(fake, 'event').retrieveDispute(
      'dp_test_1',
    );

    expect(fake.calls[0]?.method).toBe('GET');
    expect(fake.calls[0]?.path).toBe('/v1/disputes/dp_test_1');
    expect(snapshot).toStrictEqual({
      id: 'dp_test_1',
      status: 'won',
      amount: 4900,
      currency: 'usd',
      paymentIntentId: 'pi_test_1',
      balanceTransactions: [
        { id: 'txn_withdrawn', amount: -4900 },
        { id: 'txn_reinstated', amount: 4900 },
      ],
    });
  });

  test.each([
    'appeal_needs_response',
    'appeal_under_review',
    'warning_needs_response',
    'some_future_status',
  ])('状態が%sでも、その値のまま結果を返す', async (status) => {
    const fake = createFakeStripe(() =>
      stripeJson(disputeObject({ status, payment_intent: null })),
    );

    const snapshot = await gatewayWith(fake).retrieveDispute('dp_test_1');

    expect(snapshot.status).toBe(status);
    expect(snapshot.paymentIntentId).toBeNull();
  });
});

describe('StripeApiGateway(定期課金の取得)', () => {
  test('状態・解約の予約・期間の末・Customer・メタデータを返し、cancel_atが無ければ解約の予定時刻をnullにする', async () => {
    const fake = createFakeStripe(() => stripeJson(subscriptionObject()));

    const snapshot = await gatewayWith(fake, 'event').retrieveSubscription(
      'sub_test_1',
    );

    expect(fake.calls[0]?.method).toBe('GET');
    expect(fake.calls[0]?.path).toBe('/v1/subscriptions/sub_test_1');
    expect(snapshot).toStrictEqual({
      id: 'sub_test_1',
      status: 'active',
      cancelAtPeriodEnd: false,
      cancelAt: null,
      currentPeriodEnd: new Date(PERIOD_END_SECONDS * 1000),
      endedAt: null,
      customerId: 'cus_test_1',
      metadata: PURCHASE_METADATA,
    });
  });

  test('cancel_at(秒)から解約の予定時刻を作る', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(
        subscriptionObject({
          cancel_at: CANCEL_AT_SECONDS,
          customer: { id: 'cus_test_2', object: 'customer' },
        }),
      ),
    );

    const snapshot = await gatewayWith(fake).retrieveSubscription('sub_test_1');

    expect(snapshot.cancelAt).toStrictEqual(new Date(CANCEL_AT_SECONDS * 1000));
    expect(snapshot.cancelAtPeriodEnd).toBe(false);
    expect(snapshot.customerId).toBe('cus_test_2');
  });

  test('終了した定期課金は終了の時刻を返し、項目が無ければ期間の末をnullにする', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(
        subscriptionObject({
          status: 'canceled',
          ended_at: ENDED_AT_SECONDS,
          items: list([]),
        }),
      ),
    );

    const snapshot = await gatewayWith(fake).retrieveSubscription('sub_test_1');

    expect(snapshot).toMatchObject({
      status: 'canceled',
      endedAt: new Date(ENDED_AT_SECONDS * 1000),
      currentPeriodEnd: null,
    });
  });

  test('想定外の状態の値は例外にする', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(subscriptionObject({ status: 'suspended' })),
    );

    await expect(
      gatewayWith(fake).retrieveSubscription('sub_test_1'),
    ).rejects.toThrow('status');
  });
});

describe('StripeApiGateway(持ち主の手がかり)', () => {
  test('都度決済はPaymentIntentのメタデータを返し、請求の支払いでなければ定期課金のメタデータをnullにする', async () => {
    const fake = createFakeStripe((call) =>
      call.path === '/v1/invoice_payments'
        ? stripeJson(list([]))
        : stripeJson({
            id: 'pi_test_1',
            object: 'payment_intent',
            metadata: { ...PURCHASE_METADATA, purchase_kind: 'payments_smoke' },
          }),
    );

    const hint = await gatewayWith(fake, 'event').retrievePaymentIntentOwner(
      'pi_test_1',
    );

    expect(hint).toStrictEqual({
      paymentIntentId: 'pi_test_1',
      metadata: { ...PURCHASE_METADATA, purchase_kind: 'payments_smoke' },
      subscriptionMetadata: null,
    });
    expect(callTo(fake.calls, '/v1/payment_intents/pi_test_1').method).toBe(
      'GET',
    );
    const lookup = callTo(fake.calls, '/v1/invoice_payments');
    expect(lookup.method).toBe('GET');
    expect(lookup.query.get('payment[type]')).toBe('payment_intent');
    expect(lookup.query.get('payment[payment_intent]')).toBe('pi_test_1');
    expect(lookup.query.get('expand[0]')).toBe('data.invoice');
  });

  test('請求の支払いは、その請求の定期課金のメタデータを返す', async () => {
    const fake = createFakeStripe((call) =>
      call.path === '/v1/invoice_payments'
        ? stripeJson(
            list([
              {
                id: 'inpay_1',
                object: 'invoice_payment',
                is_default: true,
                invoice: invoiceObject(),
                payment: { type: 'payment_intent', payment_intent: 'pi_sub_1' },
              },
            ]),
          )
        : stripeJson({
            id: 'pi_sub_1',
            object: 'payment_intent',
            metadata: {},
          }),
    );

    const hint = await gatewayWith(fake).retrievePaymentIntentOwner('pi_sub_1');

    expect(hint).toStrictEqual({
      paymentIntentId: 'pi_sub_1',
      metadata: {},
      subscriptionMetadata: PURCHASE_METADATA,
    });
  });

  test('定期課金でない請求の支払いは、定期課金のメタデータをnullにする', async () => {
    const fake = createFakeStripe((call) =>
      call.path === '/v1/invoice_payments'
        ? stripeJson(
            list([
              {
                id: 'inpay_1',
                object: 'invoice_payment',
                is_default: true,
                invoice: invoiceObject({ parent: null }),
                payment: { type: 'payment_intent', payment_intent: 'pi_1' },
              },
            ]),
          )
        : stripeJson({ id: 'pi_1', object: 'payment_intent', metadata: {} }),
    );

    const hint = await gatewayWith(fake).retrievePaymentIntentOwner('pi_1');

    expect(hint.subscriptionMetadata).toBeNull();
  });

  test('PaymentIntentが無ければStripeNotFoundErrorになる', async () => {
    const fake = createFakeStripe((call) =>
      call.path === '/v1/invoice_payments'
        ? stripeJson(list([]))
        : stripeError(404, {
            type: 'invalid_request_error',
            code: 'resource_missing',
          }),
    );

    await expect(
      gatewayWith(fake).retrievePaymentIntentOwner('pi_missing'),
    ).rejects.toBeInstanceOf(StripeNotFoundError);
  });
});

describe('StripeApiGateway(返金の作成)', () => {
  test('PaymentIntent・金額・理由・依頼と購入のIDを、渡された冪等キーで送る', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(refundObject({ status: 'pending', amount: 1200 })),
    );

    const snapshot = await gatewayWith(fake, 'event').createRefund(
      refundInput(),
    );

    const call = fake.calls[0];
    expect(fake.calls).toHaveLength(1);
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/v1/refunds');
    expect(call?.headers.get('Idempotency-Key')).toBe(
      'refund:late:01JBQ6Z8Y3V4W5X6Y7Z8A9B0C2',
    );
    expect(call?.form).toStrictEqual({
      payment_intent: 'pi_test_1',
      amount: '1200',
      reason: 'requested_by_customer',
      'metadata[refund_request_id]': REFUND_REQUEST_ID,
      'metadata[purchase_id]': FAKE_PURCHASE_ID,
    });
    expect(snapshot).toMatchObject({
      id: 're_test_1',
      status: 'pending',
      amount: 1200,
    });
  });

  test('金額がnullなら金額を送らず、残りの全額をStripeに任せる', async () => {
    const fake = createFakeStripe(() => stripeJson(refundObject()));

    await gatewayWith(fake).createRefund(
      refundInput({ amount: null, reason: 'duplicate' }),
    );

    expect(fake.calls[0]?.form).toStrictEqual({
      payment_intent: 'pi_test_1',
      reason: 'duplicate',
      'metadata[refund_request_id]': REFUND_REQUEST_ID,
      'metadata[purchase_id]': FAKE_PURCHASE_ID,
    });
  });

  test.each([
    ['429', 429, { type: 'invalid_request_error', code: 'rate_limit' }],
    ['500', 500, { type: 'api_error' }],
  ])(
    '%sは一時的な失敗(StripeUnavailableError)になる',
    async (_, status, error) => {
      const fake = createFakeStripe(() => stripeError(status, error));

      await expect(
        gatewayWith(fake).createRefund(refundInput()),
      ).rejects.toBeInstanceOf(StripeUnavailableError);
    },
  );

  test('接続の失敗は一時的な失敗(StripeUnavailableError)になる', async () => {
    const fake = createFakeStripe(() =>
      Promise.reject(new TypeError('network connection lost')),
    );

    await expect(
      gatewayWith(fake).createRefund(refundInput()),
    ).rejects.toBeInstanceOf(StripeUnavailableError);
  });

  test.each(['charge_already_refunded', 'charge_disputed'])(
    'Stripeの拒否(%s)は恒久的な失敗(StripeRejectedError)になり、そのコードを持つ',
    async (code) => {
      const fake = createFakeStripe(() =>
        stripeError(400, { type: 'invalid_request_error', code }),
      );

      const thrown = await gatewayWith(fake)
        .createRefund(refundInput())
        .catch((caught: unknown) => caught);

      expect(thrown).toBeInstanceOf(StripeRejectedError);
      expect((thrown as StripeRejectedError).stripeErrorCode).toBe(code);
    },
  );
});

describe('StripeApiGateway(定期課金の解約)', () => {
  test('即時の解約は定期課金を削除し、canceledを返す', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(subscriptionObject({ status: 'canceled' })),
    );

    await expect(
      gatewayWith(fake, 'event').cancelSubscription('sub_test_1', {
        atPeriodEnd: false,
      }),
    ).resolves.toBe('canceled');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('DELETE');
    expect(fake.calls[0]?.path).toBe('/v1/subscriptions/sub_test_1');
  });

  test('期間末の解約はcancel_at_period_endを真にして更新し、canceledを返す', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(subscriptionObject({ cancel_at_period_end: true })),
    );

    await expect(
      gatewayWith(fake, 'event').cancelSubscription('sub_test_1', {
        atPeriodEnd: true,
      }),
    ).resolves.toBe('canceled');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('POST');
    expect(fake.calls[0]?.path).toBe('/v1/subscriptions/sub_test_1');
    expect(fake.calls[0]?.form).toStrictEqual({
      cancel_at_period_end: 'true',
    });
  });

  test.each<[boolean, string, number, Readonly<Record<string, string>>]>([
    [false, 'canceled', 400, { type: 'invalid_request_error' }],
    [true, 'canceled', 400, { type: 'invalid_request_error' }],
    [
      false,
      'incomplete_expired',
      404,
      { type: 'invalid_request_error', code: 'resource_missing' },
    ],
  ])(
    '解約(期間末=%s)が拒否され、定期課金が%sならalready_canceledを返す',
    async (atPeriodEnd, status, errorStatus, error) => {
      const fake = createFakeStripe((call) =>
        call.method === 'GET'
          ? stripeJson(subscriptionObject({ status }))
          : stripeError(errorStatus, error),
      );

      await expect(
        gatewayWith(fake).cancelSubscription('sub_test_1', { atPeriodEnd }),
      ).resolves.toBe('already_canceled');
      expect(fake.calls.map((call) => call.method)).toStrictEqual([
        atPeriodEnd ? 'POST' : 'DELETE',
        'GET',
      ]);
    },
  );

  test('解約が拒否されたのに定期課金が終わっていなければ恒久的な失敗になる', async () => {
    const fake = createFakeStripe((call) =>
      call.method === 'GET'
        ? stripeJson(subscriptionObject({ status: 'active' }))
        : stripeError(400, {
            type: 'invalid_request_error',
            code: 'parameter_invalid_empty',
          }),
    );

    const thrown = await gatewayWith(fake)
      .cancelSubscription('sub_test_1', { atPeriodEnd: false })
      .catch((caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(StripeRejectedError);
    expect((thrown as StripeRejectedError).stripeErrorCode).toBe(
      'parameter_invalid_empty',
    );
  });

  test('定期課金が存在しなければStripeNotFoundErrorになる', async () => {
    const fake = createFakeStripe(() =>
      stripeError(404, {
        type: 'invalid_request_error',
        code: 'resource_missing',
      }),
    );

    await expect(
      gatewayWith(fake).cancelSubscription('sub_missing', {
        atPeriodEnd: false,
      }),
    ).rejects.toBeInstanceOf(StripeNotFoundError);
  });

  test('解約の一時的な失敗は状態を確かめずにStripeUnavailableErrorになる', async () => {
    const fake = createFakeStripe(() =>
      stripeError(503, { type: 'api_error' }),
    );

    await expect(
      gatewayWith(fake).cancelSubscription('sub_test_1', {
        atPeriodEnd: true,
      }),
    ).rejects.toBeInstanceOf(StripeUnavailableError);
    expect(fake.calls).toHaveLength(1);
  });
});

describe('StripeApiGateway(Customer Portal)', () => {
  test('Customerと戻り先のURLでポータルのセッションを作り、そのURLを返す', async () => {
    const fake = createFakeStripe(() =>
      stripeJson({
        id: 'bps_test_1',
        object: 'billing_portal.session',
        url: 'https://billing.stripe.example/p/session/test_1',
      }),
    );

    const result = await gatewayWith(fake).createPortalSession({
      customerId: 'cus_test_1',
      returnUrl: `${FAKE_CLIENT_SITE_ORIGIN}/settings/plan?portal=returned`,
    });

    expect(result).toStrictEqual({
      url: 'https://billing.stripe.example/p/session/test_1',
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('POST');
    expect(fake.calls[0]?.path).toBe('/v1/billing_portal/sessions');
    expect(fake.calls[0]?.form).toStrictEqual({
      customer: 'cus_test_1',
      return_url: `${FAKE_CLIENT_SITE_ORIGIN}/settings/plan?portal=returned`,
    });
  });

  test('ポータルの構成が無いなどの拒否は恒久的な失敗になる', async () => {
    const fake = createFakeStripe(() =>
      stripeError(400, { type: 'invalid_request_error' }),
    );

    await expect(
      gatewayWith(fake).createPortalSession({
        customerId: 'cus_test_1',
        returnUrl: `${FAKE_CLIENT_SITE_ORIGIN}/settings/plan`,
      }),
    ).rejects.toBeInstanceOf(StripeRejectedError);
  });
});
