import { resetSync } from '@logtape/logtape';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';

import {
  type PaymentReflector,
  type ReflectionOutcome,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import {
  createFakeFulfillment,
  insertPurchase,
  readGrants,
  readRefundRows,
  snapshotOf,
} from '../../../lib/workers/payments/testing/checkout-reflection-harness.ts';
import { recordLogs } from '../../../lib/workers/payments/testing/fake-stripe.ts';
import { reflectorWith } from '../../../lib/workers/payments/testing/payment-reflector-harness.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  purchaseIdOf,
  readPurchaseRow,
  readRecords,
  readStripeObjects,
} from '../../../lib/workers/payments/testing/payment-store-fixtures.ts';
import { STRIPE_WEBHOOK_MAX_BODY_BYTES } from './stripe-webhook-route.ts';
import {
  BODY_MARKER,
  createWebhookTestApp,
  eventBody,
  nowSeconds,
  postWebhook,
  RECEIVED,
  sign,
  stubReflector,
  type WebhookRequest,
  type WebhookTestApp,
} from './testing/stripe-webhook-harness.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

// IP単位の制限の計数を他のテストファイルと分けるため、このファイルだけの接続元にする
const CLIENT_IP = '203.0.113.81';
const SECONDS_PER_MINUTE = 60;
const OTHER_WEBHOOK_SECRET = ['whsec', 'OtherRouteTest'].join('_');

function post(
  app: WebhookTestApp,
  request: Omit<WebhookRequest, 'ip'>,
): Promise<Response> {
  return postWebhook(app, { ...request, ip: CLIENT_IP });
}

function appWith(reflector: PaymentReflector) {
  return createWebhookTestApp(reflector);
}

async function expectNothingWritten(): Promise<void> {
  expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
    status: 'open',
  });
  expect(await readRecords()).toEqual([]);
  expect(await readRefundRows()).toEqual([]);
  expect(await readGrants()).toEqual([]);
  expect(await readStripeObjects()).toEqual([]);
}

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

afterAll(() => {
  resetSync();
});

describe('Webhookの経路 POST /webhooks/stripe', () => {
  test('正しい署名の決済セッションの完了の通知を反映し、200と受領だけを返す', async () => {
    await insertPurchase(1);
    const harness = reflectorWith();
    harness.stripe.put({ kind: 'session', value: snapshotOf(1) });
    const { app } = appWith(harness.reflector);

    const response = await post(app, { body: eventBody() });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toStrictEqual(RECEIVED);
    expect(await readPurchaseRow(purchaseIdOf(1))).toMatchObject({
      status: 'fulfilled',
    });
    expect(await readRecords()).toHaveLength(1);
    expect(await readGrants()).toHaveLength(1);
  });

  test('同じ対象の通知をIDと種類を変えて2回受けても、2回目は反映済みとして200を返し二重に反映しない', async () => {
    await insertPurchase(1);
    const harness = reflectorWith();
    harness.stripe.put({ kind: 'session', value: snapshotOf(1) });
    const { app } = appWith(harness.reflector);

    const first = await post(app, { body: eventBody() });
    const second = await post(app, {
      body: eventBody({
        id: 'evt_test_route_2',
        type: 'checkout.session.async_payment_succeeded',
      }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toStrictEqual(RECEIVED);
    expect(await readRecords()).toHaveLength(1);
    expect(await readGrants()).toHaveLength(1);
  });

  test('本サービスの購入に結び付かない通知は反映せずに200を返す', async () => {
    await insertPurchase(1);
    const { app } = appWith(reflectorWith().reflector);

    const response = await post(app, {
      body: eventBody({ objectId: 'cs_test_dashboard_only' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(RECEIVED);
    await expectNothingWritten();
  });

  test('受け付けない種類の通知は反映せずに200を返す', async () => {
    await insertPurchase(1);
    const harness = reflectorWith();
    const { app } = appWith(harness.reflector);

    const response = await post(app, {
      body: eventBody({ type: 'customer.created', objectId: 'cus_test_1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(RECEIVED);
    expect(harness.stripe.gateway.calls).toEqual([]);
    await expectNothingWritten();
  });

  test.each<ReflectionOutcome>([
    { kind: 'already_applied' },
    { kind: 'stale' },
    { kind: 'unresolved' },
    { kind: 'ignored' },
  ])('反映の結果が$kindの通知にも200と受領だけを返す', async (outcome) => {
    const reflector = stubReflector(outcome);
    const { app } = appWith(reflector);

    const response = await post(app, { body: eventBody() });

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(RECEIVED);
    expect(reflector.calls).toEqual([1]);
  });

  test.each<{
    readonly label: string;
    readonly signature: (body: string) => Promise<string | null>;
  }>([
    { label: '署名のヘッダーが無い', signature: () => Promise.resolve(null) },
    { label: '署名のヘッダーが空', signature: () => Promise.resolve('') },
    {
      label: '別の秘密で署名した',
      signature: (body) => sign(body, { secret: OTHER_WEBHOOK_SECRET }),
    },
    {
      label: '署名の後に本文を改ざんした',
      signature: () => sign(eventBody({ objectId: 'cs_test_other' })),
    },
    {
      label: '署名の時刻が5分を超えて古い',
      signature: (body) =>
        sign(body, { timestamp: nowSeconds() - 5 * SECONDS_PER_MINUTE - 10 }),
    },
    {
      label: '形式の誤った署名のヘッダー',
      signature: () => Promise.resolve('not-a-stripe-signature'),
    },
  ])(
    '$labelの通知はstripe_signature_invalidの400を返して反映しない',
    async ({ signature }) => {
      await insertPurchase(1);
      const harness = reflectorWith();
      harness.stripe.put({ kind: 'session', value: snapshotOf(1) });
      const { app } = appWith(harness.reflector);
      const body = eventBody();

      const response = await post(app, {
        body,
        signature: await signature(body),
      });

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toMatchObject({
        error: { code: 'stripe_signature_invalid' },
      });
      expect(harness.stripe.gateway.calls).toEqual([]);
      await expectNothingWritten();
    },
  );

  test('1MiBを超える本文は413を返して検証も反映もしない', async () => {
    const reflector = stubReflector({ kind: 'applied' });
    const { app } = appWith(reflector);
    const body = 'a'.repeat(STRIPE_WEBHOOK_MAX_BODY_BYTES + 1);

    const response = await post(app, { body, signature: null });

    expect(STRIPE_WEBHOOK_MAX_BODY_BYTES).toBe(1024 * 1024);
    expect(response.status).toBe(413);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      error: { code: 'payload_too_large' },
    });
    expect(reflector.calls).toEqual([]);
  });

  test('1MiBちょうどの本文は大きさでは拒否せず、署名を検証する', async () => {
    const reflector = stubReflector({ kind: 'applied' });
    const { app } = appWith(reflector);
    const body = 'a'.repeat(STRIPE_WEBHOOK_MAX_BODY_BYTES);

    const response = await post(app, { body, signature: null });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'stripe_signature_invalid' },
    });
    expect(reflector.calls).toEqual([]);
  });

  test('署名の秘密が未設定の環境は503を返して反映しない', async () => {
    const reflector = stubReflector({ kind: 'applied' });
    const { app } = appWith(reflector);

    const response = await post(app, {
      body: eventBody(),
      bindings: { ...env, STRIPE_WEBHOOK_SECRET: undefined },
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      error: { code: 'payments_unavailable' },
    });
    expect(reflector.calls).toEqual([]);
  });

  test.each<{
    readonly label: string;
    readonly arrange: () => ReturnType<typeof reflectorWith>;
  }>([
    {
      label: 'Stripeの一時的な失敗',
      arrange: () => {
        const harness = reflectorWith();
        harness.stripe.failNext(
          new StripeUnavailableError('Stripeに接続できません'),
        );
        return harness;
      },
    },
    {
      label: '一括の書き込みの途中の失敗',
      arrange: () => {
        const harness = reflectorWith({
          fulfillment: createFakeFulfillment({
            plan: () => ({
              kind: 'fulfill',
              statements: [
                db.run(
                  sql`INSERT INTO payments_route_test_missing_table (id) VALUES (1)`,
                ),
              ],
            }),
          }),
        });
        harness.stripe.put({ kind: 'session', value: snapshotOf(1) });
        return harness;
      },
    },
  ])(
    '反映の$labelは500を返して部分的な書き込みを残さず、通知の種類とIDだけをログとエラートラッキングへ送る',
    async ({ arrange }) => {
      await insertPurchase(1);
      const logs = recordLogs('event');
      const { app, sentryItems } = appWith(arrange().reflector);

      const response = await post(app, { body: eventBody() });

      expect(response.status).toBe(500);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.json()).toMatchObject({
        error: { code: 'internal_error' },
      });
      await expectNothingWritten();
      const errors = logs.filter(({ method }) => method === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0]?.args[0]).toMatchObject({
        category: 'event.payments.webhook',
        message: 'Stripeの通知を反映できませんでした',
        eventId: 'evt_test_route_1',
        eventType: 'checkout.session.completed',
      });
      const events = sentryItems.filter(({ type }) => type === 'event');
      expect(events).toHaveLength(1);
      expect(events[0]?.payload.tags).toMatchObject({
        stripe_event_type: 'checkout.session.completed',
        stripe_event_id: 'evt_test_route_1',
      });
      expect(JSON.stringify(logs)).not.toContain(BODY_MARKER);
      expect(JSON.stringify(sentryItems)).not.toContain(BODY_MARKER);
    },
  );

  test('POST以外のメソッドは未登録の経路と同じ404を返す', async () => {
    const reflector = stubReflector({ kind: 'applied' });
    const { app } = appWith(reflector);

    const response = await post(app, {
      body: '',
      method: 'GET',
      signature: null,
    });

    expect(response.status).toBe(404);
    expect(reflector.calls).toEqual([]);
  });
});
