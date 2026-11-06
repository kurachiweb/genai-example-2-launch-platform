import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { type Container, ContainerModule } from 'inversify';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import type { AppModule } from '../../lib/core/di/app-module.ts';
import {
  createAsyncLifecycleRegistry,
  type UserLifecycleAsyncHandler,
} from '../../lib/core/identity/user-lifecycle.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import {
  type PaymentRefunds,
  type StripeGateway,
  StripeUnavailableError,
  type StripeWebhookVerifier,
} from '../../lib/core/payments/ports.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../lib/core/payments/refund-message.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import { D1PurchaseStore } from '../../lib/workers/payments/d1-purchase-store.ts';
import { D1RefundStore } from '../../lib/workers/payments/d1-refund-store.ts';
import { StripeWebhookSignatureVerifier } from '../../lib/workers/payments/stripe-webhook-verifier.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from '../../lib/workers/payments/testing/fake-stripe-gateway.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  newPurchase,
  purchaseIdOf,
  tokenOf,
} from '../../lib/workers/payments/testing/payment-store-fixtures.ts';
import { CustomerErasureHandler } from '../application/payments/customer-erasure-handler.ts';
import { EVENT_PAYMENTS_TYPES } from '../application/payments/event-payments-types.ts';
import { OpenCheckoutExpiryHandler } from '../application/payments/open-checkout-expiry-handler.ts';
import {
  REFUND_PAYMENT_RETRY_POLICY,
  RefundPaymentHandler,
} from '../application/payments/refund-payment-handler.ts';
import { SignedStripeWebhookReceiver } from '../application/payments/stripe-webhook-receiver.ts';
import { D1PaymentAccountDataEraser } from '../infrastructure/payments/d1-payment-account-data-eraser.ts';
import { SentryRefundIncidentReporter } from '../infrastructure/payments/sentry-refund-incident-reporter.ts';
import { STRIPE_WEBHOOK_PATH } from '../presentation/payments/stripe-webhook-route.ts';
import {
  eventBody,
  RECEIVED,
  sign,
  WEBHOOK_BASE_URL,
} from '../presentation/payments/testing/stripe-webhook-harness.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';
import { MODULES } from './modules.ts';
import { USER_LIFECYCLE_ASYNC_HANDLERS } from './user-lifecycle-async-handlers.ts';

interface RecordingQueue<Body> {
  readonly queue: Queue<Body>;
  readonly sent: Body[];
}

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const PAID = 1_000;
const PAYMENT_INTENT_ID = 'pi_test_payments_module_1';
const STRIPE_REFUND_ID = 're_test_payments_module_1';
const REQUEST_KEY = 'tournament-week:entry-module';

const purchases = new D1PurchaseStore(db);
const refunds = new D1RefundStore(db);

function createContainer(
  runtimeEnv: Env = env,
  modules: readonly Pick<AppModule, 'bindings'>[] = MODULES,
): Container {
  return createInvocationContainer(
    {
      env: runtimeEnv,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'queue',
        correlationId: 'correlation-event-payments-module',
        clientIp: undefined,
      },
    },
    modules,
  );
}

function createRecordingQueue<Body>(): RecordingQueue<Body> {
  const sent: Body[] = [];
  const queue: Queue<Body> = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

// Stripeへ通信しないよう、モジュールの一覧のゲートウェイだけを偽物へ差し替える
function stripeOverride(gateway: StripeGateway): Pick<AppModule, 'bindings'> {
  return {
    bindings: new ContainerModule(({ rebind }) => {
      rebind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toConstantValue(
        gateway,
      );
    }),
  };
}

async function insertPaidPurchase(): Promise<void> {
  await db.batch([purchases.create(newPurchase(1, { amountTotal: PAID }))]);
  await db.batch([
    purchases.advance({
      purchaseId: purchaseIdOf(1),
      to: 'fulfilled',
      from: ['open'],
      nextToken: tokenOf(1001),
      patch: { stripePaymentIntentId: PAYMENT_INTENT_ID },
    }),
  ]);
}

async function deliverToJobsQueue(
  envelope: QueueEnvelope,
  gateway: FakeStripeGateway,
): Promise<{ readonly acked: boolean; readonly retried: boolean }> {
  const dispatcher = createQueueDispatcher(MESSAGE_HANDLERS, [
    ...MODULES,
    stripeOverride(gateway),
  ]);
  const id = 'payments-module-refund-message';
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id, timestamp: new Date(), attempts: 1, body: envelope },
  ]);
  const ctx = createExecutionContext();
  await dispatcher.dispatch(batch, env, ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  return {
    acked: explicitAcks.includes(id),
    retried: retryMessages.some(({ msgId }) => msgId === id),
  };
}

function postWebhook(body: string, signature: string): Promise<Response> {
  return exports.default.fetch(`${WEBHOOK_BASE_URL}${STRIPE_WEBHOOK_PATH}`, {
    method: 'POST',
    headers: {
      'CF-Connecting-IP': '203.0.113.40',
      'Content-Type': 'application/json; charset=utf-8',
      'Stripe-Signature': signature,
    },
    body,
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearPaymentTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('イベントサーバーのモジュールの一覧への決済の登録', () => {
  test('共通の束縛・イベントサーバーの決済の束縛と、通知の部品が使うメール・利用者の共通の束縛を1つずつ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    for (const name of [
      'payments-platform',
      'event-payments',
      'email-platform',
      'identity-platform',
    ]) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
    }
  });

  test.each([
    ['StripeWebhookReceiver', SignedStripeWebhookReceiver],
    ['RefundPaymentHandler', RefundPaymentHandler],
    ['RefundIncidentReporter', SentryRefundIncidentReporter],
    ['CustomerErasureHandler', CustomerErasureHandler],
    ['OpenCheckoutExpiryHandler', OpenCheckoutExpiryHandler],
    ['PaymentAccountDataEraser', D1PaymentAccountDataEraser],
  ] as const)(
    'モジュールの一覧の処理単位のコンテナから%sを解決する',
    (name, implementation) => {
      expect(createContainer().get(EVENT_PAYMENTS_TYPES[name])).toBeInstanceOf(
        implementation,
      );
    },
  );

  test('署名の検証は環境の署名の秘密で署名した本文を受け付ける', async () => {
    const verifier = createContainer().get<StripeWebhookVerifier>(
      PAYMENTS_TYPES.StripeWebhookVerifier,
    );
    const body = eventBody({ id: 'evt_test_module_verifier' });

    expect(verifier).toBeInstanceOf(StripeWebhookSignatureVerifier);
    await expect(
      verifier.verify(body, await sign(body)),
    ).resolves.toMatchObject({ id: 'evt_test_module_verifier' });
  });

  test('署名の秘密が未設定(空文字)の環境では、署名の検証が一時的な失敗になる', async () => {
    const verifier = createContainer({
      ...env,
      STRIPE_WEBHOOK_SECRET: '',
    }).get<StripeWebhookVerifier>(PAYMENTS_TYPES.StripeWebhookVerifier);
    const body = eventBody();

    await expect(verifier.verify(body, await sign(body))).rejects.toThrow(
      StripeUnavailableError,
    );
  });
});

describe('メッセージの処理と波及処理の登録', () => {
  test('返金のメッセージを返金の処理へ、最大5回の再試行の方針で登録する', () => {
    expect(
      MESSAGE_HANDLERS.filter(
        ({ contract }) => contract.type === PAYMENTS_REFUND_MESSAGE.type,
      ),
    ).toStrictEqual([
      {
        contract: PAYMENTS_REFUND_MESSAGE,
        handler: EVENT_PAYMENTS_TYPES.RefundPaymentHandler,
        retry: REFUND_PAYMENT_RETRY_POLICY,
      },
    ]);
    expect(REFUND_PAYMENT_RETRY_POLICY.maxAttempts).toBe(5);
    expect(() =>
      createQueueDispatcher(MESSAGE_HANDLERS, MODULES),
    ).not.toThrow();
  });

  test('物理削除の開始に順序400のCustomerの削除を、退会・停止に順序410の決済セッションの失効を登録する', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('payments.'),
      ),
    ).toStrictEqual([
      {
        name: 'payments.customer-erasure',
        events: ['purge_due'],
        order: 400,
        handler: EVENT_PAYMENTS_TYPES.CustomerErasureHandler,
      },
      {
        name: 'payments.open-checkout-expiry',
        events: ['withdrawn', 'suspended'],
        order: 410,
        handler: EVENT_PAYMENTS_TYPES.OpenCheckoutExpiryHandler,
      },
    ]);
  });

  test('波及処理の登録の名前と順序が重複せず、各機能の波及処理の間の順に並ぶ', () => {
    const registry = createAsyncLifecycleRegistry(
      USER_LIFECYCLE_ASYNC_HANDLERS,
    );
    const namesFor = (type: 'purge_due' | 'withdrawn' | 'suspended') =>
      registry.handlersFor(type).map(({ name }) => name);

    expect(namesFor('purge_due')).toStrictEqual([
      'inquiry-chat.member-inquiry-purge',
      'payments.customer-erasure',
    ]);
    expect(namesFor('withdrawn')).toStrictEqual([
      'payments.open-checkout-expiry',
      'identity-auth.email-suppression-cleanup',
    ]);
    expect(namesFor('suspended')).toStrictEqual([
      'payments.open-checkout-expiry',
    ]);
  });

  test('登録した波及処理の識別子をモジュールの一覧の処理単位のコンテナから解決する', () => {
    const container = createContainer();

    for (const { handler } of USER_LIFECYCLE_ASYNC_HANDLERS) {
      expect(
        typeof container.get<UserLifecycleAsyncHandler>(handler).handle,
      ).toBe('function');
    }
  });
});

describe('返金の依頼から返金の処理までの受信', () => {
  test('モジュールの一覧の返金の依頼から送った返金のメッセージを、メッセージの処理の一覧の返金の処理が受信して返金を作る', async () => {
    await insertUser(1);
    await insertPaidPurchase();
    const jobsQueue = createRecordingQueue<QueueEnvelope>();
    const paymentRefunds = createContainer({
      ...env,
      JOBS_QUEUE: jobsQueue.queue,
    }).get<PaymentRefunds>(PAYMENTS_TYPES.PaymentRefunds);
    const gateway = createFakeStripeGateway({
      findRefundByRequestId: () => Promise.resolve(undefined),
      createRefund: (input) =>
        Promise.resolve({
          id: STRIPE_REFUND_ID,
          status: 'pending',
          amount: input.amount ?? PAID,
          currency: 'usd',
          paymentIntentId: input.paymentIntentId,
          failureReason: null,
          metadata: {},
        }),
    });

    const result = await paymentRefunds.request({
      purchaseId: purchaseIdOf(1),
      amount: 300,
      reason: 'entitlement_lost',
      requestKey: REQUEST_KEY,
    });
    if (result.kind !== 'accepted') {
      throw new Error(`返金の依頼が受け付けられませんでした: ${result.code}`);
    }
    const [envelope] = jobsQueue.sent;
    if (envelope === undefined) {
      throw new Error('返金のメッセージが送られていません');
    }

    expect(envelope).toMatchObject({
      type: PAYMENTS_REFUND_MESSAGE.type,
      body: { refundRequestId: result.refundRequestId },
    });
    await expect(deliverToJobsQueue(envelope, gateway)).resolves.toStrictEqual({
      acked: true,
      retried: false,
    });
    expect(gateway.callsOf('createRefund')).toMatchObject([
      {
        args: [
          {
            paymentIntentId: PAYMENT_INTENT_ID,
            amount: 300,
            refundRequestId: result.refundRequestId,
            idempotencyKey: `refund:${REQUEST_KEY}`,
          },
        ],
      },
    ]);
    await expect(
      refunds.findById(result.refundRequestId),
    ).resolves.toMatchObject({
      status: 'submitted',
      stripeRefundId: STRIPE_REFUND_ID,
    });
  });
});

describe('エントリのWebhookの経路', () => {
  test('エントリはWebhookの経路で、環境の署名の秘密で署名された通知を受け付ける', async () => {
    const body = eventBody({
      id: 'evt_test_module_entry',
      type: 'customer.created',
    });

    const response = await postWebhook(body, await sign(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(RECEIVED);
  });

  test('エントリはWebhookの経路で、署名の不正な通知を400で拒否する', async () => {
    const body = eventBody({ id: 'evt_test_module_invalid' });

    const response = await postWebhook(
      body,
      await sign(body, { secret: 'whsec_other' }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'stripe_signature_invalid' },
    });
  });
});
