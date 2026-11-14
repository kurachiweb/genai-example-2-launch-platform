import { resetSync } from '@logtape/logtape';
import { afterAll, describe, expect, test } from 'vitest';

import {
  StripeNotFoundError,
  StripeRejectedError,
  StripeUnavailableError,
} from '../../core/payments/ports.ts';
import { createStripeClient } from './stripe-client.ts';
import { StripeApiGateway } from './stripe-gateway.ts';
import {
  checkoutInput,
  createFakeStripe,
  FAKE_CLIENT_SITE_ORIGIN,
  FAKE_EMAIL,
  FAKE_PSEUDONYMOUS_ID,
  FAKE_REQUEST_ID,
  FAKE_STRIPE_API_KEY,
  gatewayWith,
  recordLogs,
  sessionObject,
  type StripeResponder,
  stripeError,
  stripeJson,
} from './testing/fake-stripe.ts';

afterAll(() => {
  resetSync();
});

describe('StripeApiGateway(共通)', () => {
  test('固定のAPI版2026-10-28.endiveと制限付きキーで送る', async () => {
    const fake = createFakeStripe(() => stripeJson(sessionObject()));

    await gatewayWith(fake).retrieveCheckoutSession('cs_test_1');

    expect(fake.calls[0]?.headers.get('Stripe-Version')).toBe(
      '2026-10-28.endive',
    );
    expect(fake.calls[0]?.headers.get('Authorization')).toBe(
      `Bearer ${FAKE_STRIPE_API_KEY}`,
    );
  });

  test.each<[string, (gateway: StripeApiGateway) => Promise<unknown>]>([
    [
      'ensureCustomer',
      (gateway) =>
        gateway.ensureCustomer({
          existingCustomerId: null,
          email: FAKE_EMAIL,
          pseudonymousId: FAKE_PSEUDONYMOUS_ID,
        }),
    ],
    ['deleteCustomer', (gateway) => gateway.deleteCustomer('cus_test_1')],
    ['resolvePrices', (gateway) => gateway.resolvePrices(['smoke_usd'])],
    [
      'createCheckoutSession',
      (gateway) => gateway.createCheckoutSession(checkoutInput()),
    ],
    [
      'retrieveCheckoutSession',
      (gateway) => gateway.retrieveCheckoutSession('cs_test_1'),
    ],
    [
      'expireCheckoutSession',
      (gateway) => gateway.expireCheckoutSession('cs_test_1'),
    ],
    ['retrieveInvoice', (gateway) => gateway.retrieveInvoice('in_test_1')],
    ['retrieveRefund', (gateway) => gateway.retrieveRefund('re_test_1')],
    ['retrieveDispute', (gateway) => gateway.retrieveDispute('dp_test_1')],
    [
      'retrieveSubscription',
      (gateway) => gateway.retrieveSubscription('sub_test_1'),
    ],
    [
      'createRefund',
      (gateway) =>
        gateway.createRefund({
          paymentIntentId: 'pi_test_1',
          amount: null,
          reason: 'requested_by_customer',
          refundRequestId: 'refund_request_1',
          purchaseId: 'purchase_1',
          idempotencyKey: 'refund:request_1',
        }),
    ],
    [
      'cancelSubscription',
      (gateway) =>
        gateway.cancelSubscription('sub_test_1', { atPeriodEnd: false }),
    ],
    [
      'createPortalSession',
      (gateway) =>
        gateway.createPortalSession({
          customerId: 'cus_test_1',
          returnUrl: FAKE_CLIENT_SITE_ORIGIN,
        }),
    ],
    [
      'retrievePaymentIntentOwner',
      (gateway) => gateway.retrievePaymentIntentOwner('pi_test_1'),
    ],
  ])(
    'キーが未設定なら%sはStripeを呼ばずにStripeUnavailableErrorを投げる',
    async (_, operate) => {
      const gateway = new StripeApiGateway({
        appName: 'api',
        client: createStripeClient({ appName: 'api', apiKey: undefined }),
        clientSiteOrigin: FAKE_CLIENT_SITE_ORIGIN,
      });

      await expect(operate(gateway)).rejects.toBeInstanceOf(
        StripeUnavailableError,
      );
    },
  );
});

describe('StripeApiGateway(例外の分類)', () => {
  test.each<[string, StripeResponder]>([
    [
      '429',
      () =>
        stripeError(429, { type: 'invalid_request_error', code: 'rate_limit' }),
    ],
    ['500', () => stripeError(500, { type: 'api_error' })],
    ['503', () => stripeError(503, { type: 'api_error' })],
    [
      '接続の失敗',
      () => Promise.reject(new TypeError('network connection lost')),
    ],
  ])('%sは一時的な失敗(StripeUnavailableError)になる', async (_, respond) => {
    const gateway = gatewayWith(createFakeStripe(respond));

    await expect(
      gateway.retrieveCheckoutSession('cs_test_1'),
    ).rejects.toBeInstanceOf(StripeUnavailableError);
  });

  test('resource_missingは存在しない(StripeNotFoundError)になる', async () => {
    const gateway = gatewayWith(
      createFakeStripe(() =>
        stripeError(404, {
          type: 'invalid_request_error',
          code: 'resource_missing',
          message: 'No such checkout.session',
        }),
      ),
    );

    await expect(
      gateway.retrieveCheckoutSession('cs_missing'),
    ).rejects.toBeInstanceOf(StripeNotFoundError);
  });

  test.each<[number, Readonly<Record<string, string>>, string]>([
    [
      400,
      { type: 'invalid_request_error', code: 'parameter_invalid_integer' },
      'parameter_invalid_integer',
    ],
    [401, { type: 'invalid_request_error' }, 'invalid_request_error'],
    [
      403,
      { type: 'invalid_request_error', code: 'secret_key_required' },
      'secret_key_required',
    ],
  ])(
    '他の4xx(%i)は恒久的な失敗(StripeRejectedError)になり、Stripeのエラーコードを持つ',
    async (status, error, code) => {
      const gateway = gatewayWith(
        createFakeStripe(() => stripeError(status, error)),
      );

      const thrown = await gateway
        .retrieveCheckoutSession('cs_test_1')
        .catch((caught: unknown) => caught);

      expect(thrown).toBeInstanceOf(StripeRejectedError);
      expect((thrown as StripeRejectedError).stripeErrorCode).toBe(code);
    },
  );

  test('失敗のログには操作・分類・状態コード・request-idだけを残し、個人データとStripeの文言を出さない', async () => {
    const logs = recordLogs();
    const gateway = gatewayWith(
      createFakeStripe(() =>
        stripeError(400, {
          type: 'invalid_request_error',
          code: 'email_invalid',
          message: `Invalid email address: ${FAKE_EMAIL}`,
        }),
      ),
    );

    const thrown = await gateway
      .ensureCustomer({
        existingCustomerId: null,
        email: FAKE_EMAIL,
        pseudonymousId: FAKE_PSEUDONYMOUS_ID,
      })
      .catch((caught: unknown) => caught);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.method).toBe('warn');
    expect(logs[0]?.args[0]).toMatchObject({
      level: 'warning',
      category: 'api.payments.stripe',
      operation: 'ensureCustomer',
      outcome: 'rejected',
      statusCode: 400,
      stripeErrorCode: 'email_invalid',
      requestId: FAKE_REQUEST_ID,
    });
    expect(JSON.stringify(logs)).not.toContain(FAKE_EMAIL);
    expect(JSON.stringify(logs)).not.toContain(FAKE_PSEUDONYMOUS_ID);
    expect(thrown).toBeInstanceOf(StripeRejectedError);
    expect(String(thrown)).not.toContain(FAKE_EMAIL);
    expect((thrown as Error).cause).toBeUndefined();
  });

  test('カテゴリの先頭は呼び出したアプリの名前になる', async () => {
    const logs = recordLogs('event');
    const gateway = gatewayWith(
      createFakeStripe(() => stripeError(503, { type: 'api_error' })),
      'event',
    );

    await gateway.deleteCustomer('cus_test_1').catch(() => undefined);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.args[0]).toMatchObject({
      category: 'event.payments.stripe',
      operation: 'deleteCustomer',
      outcome: 'unavailable',
      statusCode: 503,
      requestId: FAKE_REQUEST_ID,
    });
  });
});

describe('StripeApiGateway(Customer)', () => {
  test('既存のCustomerが無ければ、メールアドレスと仮名化IDだけを渡して作る', async () => {
    const fake = createFakeStripe(() =>
      stripeJson({ id: 'cus_new', object: 'customer' }),
    );

    const result = await gatewayWith(fake).ensureCustomer({
      existingCustomerId: null,
      email: FAKE_EMAIL,
      pseudonymousId: FAKE_PSEUDONYMOUS_ID,
    });

    expect(result).toStrictEqual({ customerId: 'cus_new', created: true });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('POST');
    expect(fake.calls[0]?.path).toBe('/v1/customers');
    expect(fake.calls[0]?.form).toStrictEqual({
      email: FAKE_EMAIL,
      'metadata[pseudonymous_id]': FAKE_PSEUDONYMOUS_ID,
    });
  });

  test('既存のCustomerがあれば、メールアドレスと仮名化IDだけを現在の値に更新し、新しく作らない', async () => {
    const fake = createFakeStripe(() =>
      stripeJson({ id: 'cus_existing', object: 'customer' }),
    );

    const result = await gatewayWith(fake).ensureCustomer({
      existingCustomerId: 'cus_existing',
      email: FAKE_EMAIL,
      pseudonymousId: FAKE_PSEUDONYMOUS_ID,
    });

    expect(result).toStrictEqual({
      customerId: 'cus_existing',
      created: false,
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('POST');
    expect(fake.calls[0]?.path).toBe('/v1/customers/cus_existing');
    expect(fake.calls[0]?.form).toStrictEqual({
      email: FAKE_EMAIL,
      'metadata[pseudonymous_id]': FAKE_PSEUDONYMOUS_ID,
    });
  });

  test('既存のCustomerがStripeに無ければ、作り直して作成として返す', async () => {
    const fake = createFakeStripe((call) =>
      call.path === '/v1/customers/cus_gone'
        ? stripeError(404, {
            type: 'invalid_request_error',
            code: 'resource_missing',
          })
        : stripeJson({ id: 'cus_recreated', object: 'customer' }),
    );

    const result = await gatewayWith(fake).ensureCustomer({
      existingCustomerId: 'cus_gone',
      email: FAKE_EMAIL,
      pseudonymousId: FAKE_PSEUDONYMOUS_ID,
    });

    expect(result).toStrictEqual({
      customerId: 'cus_recreated',
      created: true,
    });
    expect(fake.calls.map((call) => call.path)).toStrictEqual([
      '/v1/customers/cus_gone',
      '/v1/customers',
    ]);
  });

  test('Customerを削除するとdeletedを返す', async () => {
    const fake = createFakeStripe(() =>
      stripeJson({ id: 'cus_test_1', object: 'customer', deleted: true }),
    );

    await expect(gatewayWith(fake).deleteCustomer('cus_test_1')).resolves.toBe(
      'deleted',
    );
    expect(fake.calls[0]?.method).toBe('DELETE');
    expect(fake.calls[0]?.path).toBe('/v1/customers/cus_test_1');
  });

  test('Stripeに既にCustomerが無ければalready_deletedを返す', async () => {
    const fake = createFakeStripe(() =>
      stripeError(404, {
        type: 'invalid_request_error',
        code: 'resource_missing',
      }),
    );

    await expect(gatewayWith(fake).deleteCustomer('cus_gone')).resolves.toBe(
      'already_deleted',
    );
  });

  test('削除の一時的な失敗はStripeUnavailableErrorになる', async () => {
    const fake = createFakeStripe(() =>
      stripeError(503, { type: 'api_error' }),
    );

    await expect(
      gatewayWith(fake).deleteCustomer('cus_test_1'),
    ).rejects.toBeInstanceOf(StripeUnavailableError);
  });
});

function priceObject(
  overrides: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    id: 'price_test_1',
    object: 'price',
    active: true,
    currency: 'usd',
    lookup_key: 'smoke_usd',
    recurring: null,
    type: 'one_time',
    unit_amount: 100,
    tax_behavior: 'inclusive',
    ...overrides,
  };
}

function priceList(data: readonly Record<string, unknown>[]): Response {
  return stripeJson({
    object: 'list',
    has_more: false,
    url: '/v1/prices',
    data,
  });
}

describe('StripeApiGateway(価格)', () => {
  test('有効な価格をlookup_keyで解決し、単価・通貨・定期課金の間隔を返す', async () => {
    const fake = createFakeStripe(() =>
      priceList([
        priceObject({}),
        priceObject({
          id: 'price_test_2',
          lookup_key: 'ultras_monthly_usd',
          type: 'recurring',
          recurring: { interval: 'month', interval_count: 1 },
          unit_amount: 500,
        }),
      ]),
    );

    const prices = await gatewayWith(fake).resolvePrices([
      'smoke_usd',
      'ultras_monthly_usd',
      'smoke_usd',
    ]);

    expect(prices).toStrictEqual([
      {
        lookupKey: 'smoke_usd',
        priceId: 'price_test_1',
        unitAmount: 100,
        currency: 'usd',
        recurringInterval: null,
      },
      {
        lookupKey: 'ultras_monthly_usd',
        priceId: 'price_test_2',
        unitAmount: 500,
        currency: 'usd',
        recurringInterval: 'month',
      },
    ]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.method).toBe('GET');
    expect(fake.calls[0]?.path).toBe('/v1/prices');
    expect(fake.calls[0]?.query.get('lookup_keys[0]')).toBe('smoke_usd');
    expect(fake.calls[0]?.query.get('lookup_keys[1]')).toBe(
      'ultras_monthly_usd',
    );
    expect(fake.calls[0]?.query.has('lookup_keys[2]')).toBe(false);
    expect(fake.calls[0]?.query.get('active')).toBe('true');
  });

  test('lookup_keyが10件を超えると10件ずつに分けて照会する', async () => {
    const fake = createFakeStripe(() => priceList([]));
    const keys = Array.from(
      { length: 11 },
      (_, index) => `key_${String(index)}`,
    );

    await gatewayWith(fake).resolvePrices(keys);

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.query.has('lookup_keys[9]')).toBe(true);
    expect(fake.calls[0]?.query.has('lookup_keys[10]')).toBe(false);
    expect(fake.calls[1]?.query.get('lookup_keys[0]')).toBe('key_10');
  });

  test('lookup_keyが空ならStripeを呼ばない', async () => {
    const fake = createFakeStripe(() => priceList([]));

    await expect(gatewayWith(fake).resolvePrices([])).resolves.toStrictEqual(
      [],
    );
    expect(fake.calls).toHaveLength(0);
  });

  test('USDでない・単価が無い・月ごとでない価格は除き、lookup_keyと理由だけを警告ログに残す', async () => {
    const logs = recordLogs();
    const fake = createFakeStripe(() =>
      priceList([
        priceObject({ lookup_key: 'jpy', currency: 'jpy' }),
        priceObject({ lookup_key: 'custom', unit_amount: null }),
        priceObject({
          lookup_key: 'yearly',
          type: 'recurring',
          recurring: { interval: 'year', interval_count: 1 },
        }),
        priceObject({
          lookup_key: 'bimonthly',
          type: 'recurring',
          recurring: { interval: 'month', interval_count: 2 },
        }),
      ]),
    );

    const prices = await gatewayWith(fake).resolvePrices([
      'jpy',
      'custom',
      'yearly',
      'bimonthly',
    ]);

    expect(prices).toStrictEqual([]);
    expect(logs).toHaveLength(4);
    expect(logs.map((log) => log.args[0])).toMatchObject([
      {
        level: 'warning',
        category: 'api.payments.stripe',
        priceLookup: 'jpy',
        reason: 'currency',
      },
      { priceLookup: 'custom', reason: 'unit_amount' },
      { priceLookup: 'yearly', reason: 'interval' },
      { priceLookup: 'bimonthly', reason: 'interval' },
    ]);
  });

  test('税の扱いが税込でない価格(税抜・未指定)は除き、lookup_keyと理由だけを警告ログに残す', async () => {
    const logs = recordLogs();
    const fake = createFakeStripe(() =>
      priceList([
        priceObject({ lookup_key: 'exclusive', tax_behavior: 'exclusive' }),
        priceObject({ lookup_key: 'unspecified', tax_behavior: 'unspecified' }),
        priceObject({ lookup_key: 'missing', tax_behavior: null }),
        priceObject({ lookup_key: 'inclusive' }),
      ]),
    );

    const prices = await gatewayWith(fake).resolvePrices([
      'exclusive',
      'unspecified',
      'missing',
      'inclusive',
    ]);

    expect(prices.map(({ lookupKey }) => lookupKey)).toStrictEqual([
      'inclusive',
    ]);
    expect(logs.map((log) => log.args[0])).toMatchObject([
      { priceLookup: 'exclusive', reason: 'tax_behavior' },
      { priceLookup: 'unspecified', reason: 'tax_behavior' },
      { priceLookup: 'missing', reason: 'tax_behavior' },
    ]);
  });
});
