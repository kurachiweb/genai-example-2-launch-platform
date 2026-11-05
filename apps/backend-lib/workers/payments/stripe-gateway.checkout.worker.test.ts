import { describe, expect, test } from 'vitest';

import {
  StripeNotFoundError,
  StripeRejectedError,
} from '../../core/payments/ports.ts';
import { CHECKOUT_INTEGRATION_IDENTIFIER } from '../../core/payments/stripe-api-version.ts';
import {
  checkoutInput,
  createFakeStripe,
  FAKE_CLIENT_SITE_ORIGIN,
  FAKE_EXPIRES_AT_SECONDS,
  FAKE_PSEUDONYMOUS_ID,
  FAKE_PURCHASE_ID,
  gatewayWith,
  sessionObject,
  stripeError,
  stripeJson,
} from './testing/fake-stripe.ts';

function paidSessionWithCharge(
  paymentMethodDetails: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return sessionObject({
    status: 'complete',
    payment_status: 'paid',
    client_secret: null,
    payment_intent: {
      id: 'pi_test_1',
      object: 'payment_intent',
      latest_charge: {
        id: 'ch_test_1',
        object: 'charge',
        payment_method_details: paymentMethodDetails,
      },
    },
  });
}

function invoicePayment(
  id: string,
  paymentIntentId: string,
  isDefault: boolean,
): Record<string, unknown> {
  return {
    id,
    object: 'invoice_payment',
    is_default: isDefault,
    payment: { type: 'payment_intent', payment_intent: paymentIntentId },
  };
}

describe('StripeApiGateway(決済セッションの作成)', () => {
  test('都度決済は設計の項目と冪等キーで作り、payment_method_typesを送らない', async () => {
    const fake = createFakeStripe(() => stripeJson(sessionObject()));

    await gatewayWith(fake).createCheckoutSession(checkoutInput());

    const call = fake.calls[0];
    expect(fake.calls).toHaveLength(1);
    expect(call?.method).toBe('POST');
    expect(call?.path).toBe('/v1/checkout/sessions');
    expect(call?.headers.get('Idempotency-Key')).toBe(
      `checkout:${FAKE_PURCHASE_ID}`,
    );
    expect(call?.form).toStrictEqual({
      ui_mode: 'elements',
      mode: 'payment',
      customer: 'cus_test_1',
      'customer_update[address]': 'auto',
      'line_items[0][price]': 'price_test_1',
      'line_items[0][quantity]': '3',
      'automatic_tax[enabled]': 'true',
      billing_address_collection: 'auto',
      'adaptive_pricing[enabled]': 'false',
      'allowed_payment_method_types[0]': 'card',
      'allowed_payment_method_types[1]': 'link',
      return_url: `${FAKE_CLIENT_SITE_ORIGIN}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      expires_at: String(FAKE_EXPIRES_AT_SECONDS),
      client_reference_id: FAKE_PURCHASE_ID,
      'metadata[purchase_id]': FAKE_PURCHASE_ID,
      'metadata[purchase_kind]': 'payments_smoke',
      'metadata[pseudonymous_id]': FAKE_PSEUDONYMOUS_ID,
      'payment_intent_data[metadata][purchase_id]': FAKE_PURCHASE_ID,
      'payment_intent_data[metadata][purchase_kind]': 'payments_smoke',
      'payment_intent_data[metadata][pseudonymous_id]': FAKE_PSEUDONYMOUS_ID,
      integration_identifier: CHECKOUT_INTEGRATION_IDENTIFIER,
    });
    expect(
      Object.keys(call?.form ?? {}).filter((key) =>
        key.startsWith('payment_method_types'),
      ),
    ).toStrictEqual([]);
  });

  test('定期課金はメタデータをsubscription_dataに付け、payment_intent_dataを送らない', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(sessionObject({ mode: 'subscription' })),
    );

    await gatewayWith(fake).createCheckoutSession(
      checkoutInput({
        mode: 'subscription',
        quantity: 1,
        metadata: {
          purchase_id: FAKE_PURCHASE_ID,
          purchase_kind: 'ultras',
          pseudonymous_id: FAKE_PSEUDONYMOUS_ID,
        },
      }),
    );

    const form = fake.calls[0]?.form ?? {};
    expect(form).toMatchObject({
      mode: 'subscription',
      'metadata[purchase_kind]': 'ultras',
      'subscription_data[metadata][purchase_id]': FAKE_PURCHASE_ID,
      'subscription_data[metadata][purchase_kind]': 'ultras',
      'subscription_data[metadata][pseudonymous_id]': FAKE_PSEUDONYMOUS_ID,
    });
    expect(
      Object.keys(form).filter((key) => key.startsWith('payment_intent_data')),
    ).toStrictEqual([]);
  });

  test('作成した決済セッションをStripeの型を含まない読み取り専用の結果で返す', async () => {
    const fake = createFakeStripe(() => stripeJson(sessionObject()));

    const snapshot =
      await gatewayWith(fake).createCheckoutSession(checkoutInput());

    expect(snapshot).toStrictEqual({
      id: 'cs_test_1',
      status: 'open',
      paymentStatus: 'unpaid',
      clientSecret: 'cs_test_1_secret_abc',
      amountTotal: 4900,
      currency: 'usd',
      expiresAt: new Date(FAKE_EXPIRES_AT_SECONDS * 1000),
      paymentIntentId: null,
      invoiceId: null,
      subscriptionId: null,
      linkFundingSourceGroup: null,
      metadata: {
        purchase_id: FAKE_PURCHASE_ID,
        purchase_kind: 'payments_smoke',
        pseudonymous_id: FAKE_PSEUDONYMOUS_ID,
      },
    });
  });
});

describe('StripeApiGateway(決済セッションの取得)', () => {
  test('都度決済は支払いと最新の請求を展開し、PaymentIntent・Linkの資金源のグループ・メタデータを返す', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(
        paidSessionWithCharge({
          type: 'link',
          link: { country: 'US', funding_source_group: 'lfsg_003' },
        }),
      ),
    );

    const snapshot =
      await gatewayWith(fake).retrieveCheckoutSession('cs_test_1');

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('GET');
    expect(fake.calls[0]?.path).toBe('/v1/checkout/sessions/cs_test_1');
    expect(fake.calls[0]?.query.get('expand[0]')).toBe(
      'payment_intent.latest_charge',
    );
    expect(fake.calls[0]?.query.get('expand[1]')).toBe('invoice.payments');
    expect(snapshot).toMatchObject({
      status: 'complete',
      paymentStatus: 'paid',
      clientSecret: null,
      paymentIntentId: 'pi_test_1',
      invoiceId: null,
      subscriptionId: null,
      linkFundingSourceGroup: 'lfsg_003',
      metadata: { purchase_id: FAKE_PURCHASE_ID },
    });
  });

  test('カードのウォレットとしてのLinkの資金源のグループも返す', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(
        paidSessionWithCharge({
          type: 'card',
          card: {
            wallet: {
              type: 'link',
              link: { funding_source_group: 'lfsg_000' },
            },
          },
        }),
      ),
    );

    const snapshot =
      await gatewayWith(fake).retrieveCheckoutSession('cs_test_1');

    expect(snapshot.linkFundingSourceGroup).toBe('lfsg_000');
  });

  test('Link以外の支払いでは資金源のグループをnullにする', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(
        paidSessionWithCharge({ type: 'card', card: { wallet: null } }),
      ),
    );

    const snapshot =
      await gatewayWith(fake).retrieveCheckoutSession('cs_test_1');

    expect(snapshot.paymentIntentId).toBe('pi_test_1');
    expect(snapshot.linkFundingSourceGroup).toBeNull();
  });

  test('定期課金は初回の請求の既定の支払いからPaymentIntentを解決し、その最新の請求からLinkの資金源のグループを返す', async () => {
    const fake = createFakeStripe((call) =>
      call.path === '/v1/payment_intents/pi_sub_1'
        ? stripeJson({
            id: 'pi_sub_1',
            object: 'payment_intent',
            latest_charge: {
              id: 'ch_sub_1',
              object: 'charge',
              payment_method_details: {
                type: 'link',
                link: { funding_source_group: 'lfsg_000' },
              },
            },
          })
        : stripeJson(
            sessionObject({
              mode: 'subscription',
              status: 'complete',
              payment_status: 'paid',
              subscription: 'sub_test_1',
              invoice: {
                id: 'in_test_1',
                object: 'invoice',
                payments: {
                  object: 'list',
                  has_more: false,
                  data: [
                    invoicePayment('inpay_old', 'pi_old', false),
                    invoicePayment('inpay_1', 'pi_sub_1', true),
                  ],
                },
              },
            }),
          ),
    );

    const snapshot =
      await gatewayWith(fake).retrieveCheckoutSession('cs_test_1');

    expect(fake.calls.map((call) => call.path)).toStrictEqual([
      '/v1/checkout/sessions/cs_test_1',
      '/v1/payment_intents/pi_sub_1',
    ]);
    expect(fake.calls[1]?.query.get('expand[0]')).toBe('latest_charge');
    expect(snapshot).toMatchObject({
      paymentIntentId: 'pi_sub_1',
      invoiceId: 'in_test_1',
      subscriptionId: 'sub_test_1',
      linkFundingSourceGroup: 'lfsg_000',
    });
  });

  test('定期課金の請求に支払いが無ければPaymentIntentを取得しない', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(
        sessionObject({
          mode: 'subscription',
          status: 'complete',
          payment_status: 'no_payment_required',
          subscription: { id: 'sub_test_1', object: 'subscription' },
          invoice: {
            id: 'in_test_1',
            object: 'invoice',
            payments: { object: 'list', has_more: false, data: [] },
          },
        }),
      ),
    );

    const snapshot =
      await gatewayWith(fake).retrieveCheckoutSession('cs_test_1');

    expect(fake.calls).toHaveLength(1);
    expect(snapshot).toMatchObject({
      paymentStatus: 'no_payment_required',
      paymentIntentId: null,
      invoiceId: 'in_test_1',
      subscriptionId: 'sub_test_1',
      linkFundingSourceGroup: null,
    });
  });

  test.each([
    ['status', { status: 'archived' }],
    ['payment_status', { payment_status: 'pending' }],
  ])('想定外の%sの値は例外にする', async (field, overrides) => {
    const fake = createFakeStripe(() => stripeJson(sessionObject(overrides)));

    await expect(
      gatewayWith(fake).retrieveCheckoutSession('cs_test_1'),
    ).rejects.toThrow(field);
  });
});

describe('StripeApiGateway(決済セッションの失効)', () => {
  test('未完了の決済セッションを失効させるとexpiredを返す', async () => {
    const fake = createFakeStripe(() =>
      stripeJson(sessionObject({ status: 'expired' })),
    );

    await expect(
      gatewayWith(fake).expireCheckoutSession('cs_test_1'),
    ).resolves.toBe('expired');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('POST');
    expect(fake.calls[0]?.path).toBe('/v1/checkout/sessions/cs_test_1/expire');
  });

  test.each(['complete', 'expired'])(
    '失効が拒否され、決済セッションが%sならnot_openを返す',
    async (status) => {
      const fake = createFakeStripe((call) =>
        call.path.endsWith('/expire')
          ? stripeError(400, {
              type: 'invalid_request_error',
              message:
                'Only Checkout Sessions with a status in ["open"] can be expired.',
            })
          : stripeJson(sessionObject({ status })),
      );

      await expect(
        gatewayWith(fake).expireCheckoutSession('cs_test_1'),
      ).resolves.toBe('not_open');
      expect(fake.calls.map((call) => call.path)).toStrictEqual([
        '/v1/checkout/sessions/cs_test_1/expire',
        '/v1/checkout/sessions/cs_test_1',
      ]);
    },
  );

  test('失効が拒否されたのに決済セッションがopenのままなら恒久的な失敗になる', async () => {
    const fake = createFakeStripe((call) =>
      call.path.endsWith('/expire')
        ? stripeError(400, {
            type: 'invalid_request_error',
            code: 'parameter_invalid_empty',
          })
        : stripeJson(sessionObject({ status: 'open' })),
    );

    const thrown = await gatewayWith(fake)
      .expireCheckoutSession('cs_test_1')
      .catch((caught: unknown) => caught);

    expect(thrown).toBeInstanceOf(StripeRejectedError);
    expect((thrown as StripeRejectedError).stripeErrorCode).toBe(
      'parameter_invalid_empty',
    );
  });

  test('決済セッションが無ければStripeNotFoundErrorになる', async () => {
    const fake = createFakeStripe(() =>
      stripeError(404, {
        type: 'invalid_request_error',
        code: 'resource_missing',
      }),
    );

    await expect(
      gatewayWith(fake).expireCheckoutSession('cs_missing'),
    ).rejects.toBeInstanceOf(StripeNotFoundError);
    expect(fake.calls).toHaveLength(1);
  });
});
