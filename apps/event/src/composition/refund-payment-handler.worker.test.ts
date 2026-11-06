import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import type { RejectionReason } from '../../common-lib/payments/purchase-states.ts';
import { createUlidGenerator } from '../../lib/core/ids/id-generator.ts';
import { MESSAGE_CONTRACTS } from '../../lib/core/messaging/contracts/index.ts';
import type {
  DeadLetterNotice,
  QueueEnvelope,
} from '../../lib/core/messaging/envelope.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import {
  type PurchaseRecord,
  type PurchaseStore,
  type RefundRequestRecord,
  type RefundStore,
  type StripeGateway,
  type StripeRefundSnapshot,
  StripeRejectedError,
  StripeUnavailableError,
} from '../../lib/core/payments/ports.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../lib/core/payments/refund-message.ts';
import { reflectionRequestKeyOf } from '../../lib/core/payments/refund-rules.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import { createMessagePublisher } from '../../lib/workers/messaging/queue-publisher.ts';
import { D1PurchaseStore } from '../../lib/workers/payments/d1-purchase-store.ts';
import { D1RefundStore } from '../../lib/workers/payments/d1-refund-store.ts';
import { D1PaymentRefunds } from '../../lib/workers/payments/payment-refunds.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from '../../lib/workers/payments/testing/fake-stripe-gateway.ts';
import {
  after,
  clearPaymentTables,
  db,
  insertUser,
  newPurchase,
  newRefundRequest,
  purchaseIdOf,
  refundIdOf,
  tokenOf,
} from '../../lib/workers/payments/testing/payment-store-fixtures.ts';
import { EVENT_PAYMENTS_TYPES } from '../application/payments/event-payments-types.ts';
import type {
  RefundIncident,
  RefundIncidentReporter,
} from '../application/payments/refund-incidents.ts';
import {
  REFUND_PAYMENT_RETRY_POLICY,
  RefundPaymentHandler,
} from '../application/payments/refund-payment-handler.ts';

declare global {
  // @cloudflare/vitest-pool-workers 0.23.0の型定義はgetQueueResultの戻り値にこの型を使うが、宣言を含まない
  interface FetcherQueueResult {
    readonly outcome: string;
    readonly ackAll: boolean;
    readonly retryBatch: { readonly retry: boolean };
    readonly explicitAcks: readonly string[];
    readonly retryMessages: readonly { readonly msgId: string }[];
  }
}

interface MessageOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly delaySeconds?: number;
}

interface RecordingQueue<Body> {
  readonly queue: Queue<Body>;
  readonly sent: Body[];
}

interface RefundHarness {
  readonly incidents: readonly RefundIncident[];
  readonly deadLetters: readonly DeadLetterNotice[];
  deliver(envelope: QueueEnvelope, attempts?: number): Promise<MessageOutcome>;
}

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const PAID = 1_000;
const PAYMENT_INTENT_ID = 'pi_test_refund_handler_1';
const SUBSCRIPTION_ID = 'sub_test_refund_handler_1';
const STRIPE_REFUND_ID = 're_test_refund_handler_1';
const REQUEST_KEY = 'tournament-week:entry-1';
const MESSAGE_TIMESTAMP = new Date('2026-11-01T00:01:00.000Z');

const ACKED: MessageOutcome = { acked: true, retried: false };

const clock: Clock = { now: () => after(60_000) };
const ids = createUlidGenerator(clock);
const purchases = new D1PurchaseStore(db);
const refunds = new D1RefundStore(db);

let messageSequence = 0;

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

function refundSnapshotOf(
  input: { readonly amount: number },
  overrides: Partial<StripeRefundSnapshot> = {},
): StripeRefundSnapshot {
  return {
    id: STRIPE_REFUND_ID,
    status: 'pending',
    amount: input.amount,
    currency: 'usd',
    paymentIntentId: PAYMENT_INTENT_ID,
    failureReason: null,
    metadata: {},
    ...overrides,
  };
}

function refundingGateway(
  handlers: Partial<StripeGateway> = {},
): FakeStripeGateway {
  return createFakeStripeGateway({
    createRefund: (input) =>
      Promise.resolve(refundSnapshotOf({ amount: input.amount ?? PAID })),
    ...handlers,
  });
}

function envelopeOf(refundRequestId: string): QueueEnvelope {
  return {
    v: 1,
    type: PAYMENTS_REFUND_MESSAGE.type,
    id: ids.generate(),
    sentAt: MESSAGE_TIMESTAMP.toISOString(),
    body: { refundRequestId },
  };
}

// 0.23.0のretry()は遅延の指定を記録しないため、ack・retryの状態はgetQueueResultで、遅延秒数はretryの呼び出しの引数で確かめる
async function runBatch(
  envelope: QueueEnvelope,
  attempts: number,
  run: (batch: MessageBatch, ctx: ExecutionContext) => Promise<void>,
): Promise<MessageOutcome> {
  messageSequence += 1;
  const id = `refund-queue-message-${String(messageSequence)}`;
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id, timestamp: MESSAGE_TIMESTAMP, attempts, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージがありません');
  }
  const retrySpy = vi.spyOn(message, 'retry');
  const ctx = createExecutionContext();
  await run(batch, ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  const retried = retryMessages.some(({ msgId }) => msgId === id);
  const delaySeconds = retrySpy.mock.calls.at(-1)?.[0]?.delaySeconds;
  return {
    acked: explicitAcks.includes(id),
    retried,
    ...(retried && delaySeconds !== undefined ? { delaySeconds } : {}),
  };
}

// 返金の処理を本番と同じQueueのconsumerから呼び、依頼と購入はテスト用のD1から読ませる
function harnessWith(
  gateway: StripeGateway,
  purchaseStore?: PurchaseStore,
): RefundHarness {
  const incidents: RefundIncident[] = [];
  const reporter: RefundIncidentReporter = {
    report: (incident) => {
      incidents.push(incident);
    },
  };
  const deadLetterQueue = createRecordingQueue<DeadLetterNotice>();
  const bindings = new ContainerModule(({ bind }) => {
    bind<RefundStore>(PAYMENTS_TYPES.RefundStore).to(D1RefundStore);
    if (purchaseStore === undefined) {
      bind<PurchaseStore>(PAYMENTS_TYPES.PurchaseStore).to(D1PurchaseStore);
    } else {
      bind<PurchaseStore>(PAYMENTS_TYPES.PurchaseStore).toConstantValue(
        purchaseStore,
      );
    }
    bind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toConstantValue(gateway);
    bind<RefundIncidentReporter>(
      EVENT_PAYMENTS_TYPES.RefundIncidentReporter,
    ).toConstantValue(reporter);
    bind<RefundPaymentHandler>(EVENT_PAYMENTS_TYPES.RefundPaymentHandler).to(
      RefundPaymentHandler,
    );
  });
  const dispatcher = createQueueDispatcher(
    [
      {
        contract: PAYMENTS_REFUND_MESSAGE,
        handler: EVENT_PAYMENTS_TYPES.RefundPaymentHandler,
        retry: REFUND_PAYMENT_RETRY_POLICY,
      },
    ],
    [{ bindings }],
  );
  const runtimeEnv = { ...env, JOBS_DLQ: deadLetterQueue.queue };
  return {
    incidents,
    deadLetters: deadLetterQueue.sent,
    deliver: (envelope, attempts = 1) =>
      runBatch(envelope, attempts, (batch, ctx) =>
        dispatcher.dispatch(batch, runtimeEnv, ctx),
      ),
  };
}

async function insertPurchase(
  index: number,
  options: {
    readonly status?: 'fulfilled' | 'rejected';
    readonly rejectionReason?: RejectionReason;
    readonly paymentIntentId?: string | null;
    readonly subscriptionId?: string | null;
  } = {},
): Promise<void> {
  await db.batch([purchases.create(newPurchase(index, { amountTotal: PAID }))]);
  await db.batch([
    purchases.advance({
      purchaseId: purchaseIdOf(index),
      to: options.status ?? 'fulfilled',
      from: ['open'],
      nextToken: tokenOf(index + 1000),
      patch: {
        stripePaymentIntentId:
          options.paymentIntentId === undefined
            ? PAYMENT_INTENT_ID
            : options.paymentIntentId,
        stripeSubscriptionId: options.subscriptionId ?? null,
        ...(options.rejectionReason === undefined
          ? {}
          : { rejectionReason: options.rejectionReason }),
      },
    }),
  ]);
}

// 後続specの依頼と同じ経路(依頼の記録と送信)で依頼し、送られた封筒を返す
async function requestRefund(
  amount: number | null = null,
): Promise<{ readonly refundRequestId: string; envelope: QueueEnvelope }> {
  const queue = createRecordingQueue<QueueEnvelope>();
  const paymentRefunds = new D1PaymentRefunds({
    appName: 'event',
    db,
    purchases,
    refunds,
    refundStatements: refunds,
    publisher: createMessagePublisher(
      queue.queue,
      MESSAGE_CONTRACTS,
      ids,
      clock,
    ),
    ids,
    clock,
  });
  const result = await paymentRefunds.request({
    purchaseId: purchaseIdOf(1),
    amount,
    reason: 'entitlement_lost',
    requestKey: REQUEST_KEY,
  });
  if (result.kind !== 'accepted') {
    throw new Error(`返金の依頼が受け付けられませんでした: ${result.code}`);
  }
  const [envelope] = queue.sent;
  if (envelope === undefined) {
    throw new Error('返金のメッセージが送られていません');
  }
  return { refundRequestId: result.refundRequestId, envelope };
}

// 反映と同じ経路(購入の拒否と同じ一括の書き込みで全額の依頼を記録してから送信)で依頼し、送られた封筒を返す
async function requestReflectionRefund(options: {
  readonly reason: RejectionReason;
  readonly subscriptionId?: string;
}): Promise<{ readonly refundRequestId: string; envelope: QueueEnvelope }> {
  const queue = createRecordingQueue<QueueEnvelope>();
  const paymentRefunds = new D1PaymentRefunds({
    appName: 'event',
    db,
    purchases,
    refunds,
    refundStatements: refunds,
    publisher: createMessagePublisher(
      queue.queue,
      MESSAGE_CONTRACTS,
      ids,
      clock,
    ),
    ids,
    clock,
  });
  await db.batch([purchases.create(newPurchase(1, { amountTotal: PAID }))]);
  const prepared = paymentRefunds.prepareForReflection({
    purchaseId: purchaseIdOf(1),
    amountPaid: PAID,
    reason: options.reason,
    requestKey: reflectionRequestKeyOf(purchaseIdOf(1)),
  });
  await db.batch([
    purchases.advance({
      purchaseId: purchaseIdOf(1),
      to: 'rejected',
      from: ['open'],
      nextToken: tokenOf(1001),
      patch: {
        rejectionReason: options.reason,
        stripePaymentIntentId: PAYMENT_INTENT_ID,
        stripeSubscriptionId: options.subscriptionId ?? null,
      },
    }),
    ...prepared.statements,
  ]);
  await paymentRefunds.dispatch(prepared.refundRequestId);
  const [envelope] = queue.sent;
  if (envelope === undefined) {
    throw new Error('返金のメッセージが送られていません');
  }
  return { refundRequestId: prepared.refundRequestId, envelope };
}

async function insertRefundRequest(
  index: number,
  status?: RefundRequestRecord['status'],
): Promise<void> {
  await db.batch([refunds.insert(newRefundRequest(index))]);
  if (status !== undefined) {
    await refunds.updateStatus({
      refundRequestId: refundIdOf(index),
      status,
      stripeRefundId: `re_test_existing_${String(index)}`,
    });
  }
}

async function requestRow(
  refundRequestId: string,
): Promise<RefundRequestRecord | undefined> {
  return refunds.findById(refundRequestId);
}

class MissingPurchaseStore extends D1PurchaseStore {
  override findById(): Promise<PurchaseRecord | undefined> {
    return Promise.resolve(undefined);
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearPaymentTables();
  await insertUser(1);
});

describe('返金の処理の返金の作成', () => {
  test('後続specの依頼は、購入のPaymentIntentのIDと依頼の金額・理由・冪等キーで返金を作り、返金IDを保存して提出済みにする', async () => {
    await insertPurchase(1);
    const { refundRequestId, envelope } = await requestRefund(300);
    const gateway = refundingGateway();
    const harness = harnessWith(gateway);

    const outcome = await harness.deliver(envelope);

    expect(outcome).toEqual(ACKED);
    expect(gateway.calls).toEqual([
      {
        method: 'createRefund',
        args: [
          {
            paymentIntentId: PAYMENT_INTENT_ID,
            amount: 300,
            reason: 'requested_by_customer',
            refundRequestId,
            purchaseId: purchaseIdOf(1),
            idempotencyKey: `refund:${REQUEST_KEY}`,
          },
        ],
      },
    ]);
    expect(await requestRow(refundRequestId)).toMatchObject({
      status: 'submitted',
      stripeRefundId: STRIPE_REFUND_ID,
      failureCode: null,
    });
    expect(harness.incidents).toEqual([]);
  });

  test('反映からの二重決済の依頼は、支払額の全額をStripeの理由duplicateで返金し、自動返金の依頼キーから冪等キーを作る', async () => {
    const { refundRequestId, envelope } = await requestReflectionRefund({
      reason: 'duplicate',
    });
    const gateway = refundingGateway();
    const harness = harnessWith(gateway);

    const outcome = await harness.deliver(envelope);

    expect(outcome).toEqual(ACKED);
    expect(gateway.calls.map(({ method }) => method)).toEqual(['createRefund']);
    expect(gateway.callsOf('createRefund')[0]?.args[0]).toEqual({
      paymentIntentId: PAYMENT_INTENT_ID,
      amount: PAID,
      reason: 'duplicate',
      refundRequestId,
      purchaseId: purchaseIdOf(1),
      idempotencyKey: `refund:${reflectionRequestKeyOf(purchaseIdOf(1))}`,
    });
    expect(await requestRow(refundRequestId)).toMatchObject({
      status: 'submitted',
      stripeRefundId: STRIPE_REFUND_ID,
    });
  });

  test('拒否された定期課金の購入は、返金の作成の前に定期課金を即時に解約する', async () => {
    const { refundRequestId, envelope } = await requestReflectionRefund({
      reason: 'late',
      subscriptionId: SUBSCRIPTION_ID,
    });
    const gateway = refundingGateway({
      cancelSubscription: () => Promise.resolve('canceled'),
    });
    const harness = harnessWith(gateway);

    const outcome = await harness.deliver(envelope);

    expect(outcome).toEqual(ACKED);
    expect(gateway.calls.map(({ method }) => method)).toEqual([
      'cancelSubscription',
      'createRefund',
    ]);
    expect(gateway.callsOf('cancelSubscription')[0]?.args).toEqual([
      SUBSCRIPTION_ID,
      { atPeriodEnd: false },
    ]);
    expect(await requestRow(refundRequestId)).toMatchObject({
      status: 'submitted',
      stripeRefundId: STRIPE_REFUND_ID,
    });
  });

  test('既に解約済みの定期課金は無視して返金を作る', async () => {
    const { refundRequestId, envelope } = await requestReflectionRefund({
      reason: 'ineligible',
      subscriptionId: SUBSCRIPTION_ID,
    });
    const gateway = refundingGateway({
      cancelSubscription: () => Promise.resolve('already_canceled'),
    });
    const harness = harnessWith(gateway);

    await harness.deliver(envelope);

    expect(gateway.calls.map(({ method }) => method)).toEqual([
      'cancelSubscription',
      'createRefund',
    ]);
    expect((await requestRow(refundRequestId))?.status).toBe('submitted');
  });

  test('拒否されていない定期課金の購入への返金では定期課金を解約しない', async () => {
    await insertPurchase(1, { subscriptionId: SUBSCRIPTION_ID });
    const { envelope } = await requestRefund();
    const gateway = refundingGateway();
    const harness = harnessWith(gateway);

    await harness.deliver(envelope);

    expect(gateway.calls.map(({ method }) => method)).toEqual(['createRefund']);
  });
});

describe('返金の処理の冪等性', () => {
  test('一時的な失敗の後に同じメッセージを処理し直すと、同じ冪等キーで返金の作成を呼ぶ', async () => {
    await insertPurchase(1);
    const { refundRequestId, envelope } = await requestRefund();
    let attempt = 0;
    const gateway = refundingGateway({
      createRefund: (input) => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new StripeUnavailableError('一時的な失敗'))
          : Promise.resolve(refundSnapshotOf({ amount: input.amount ?? PAID }));
      },
    });
    const harness = harnessWith(gateway);

    await harness.deliver(envelope, 1);
    await harness.deliver(envelope, 2);

    const keys = gateway
      .callsOf('createRefund')
      .map(
        ({ args }) => (args[0] as { idempotencyKey: string }).idempotencyKey,
      );
    expect(keys).toEqual([`refund:${REQUEST_KEY}`, `refund:${REQUEST_KEY}`]);
    expect((await requestRow(refundRequestId))?.status).toBe('submitted');
  });

  test('返金を作った後に同じメッセージが再び届いても、Stripeを呼ばずに終える', async () => {
    await insertPurchase(1);
    const { refundRequestId, envelope } = await requestRefund();
    const gateway = refundingGateway();
    const harness = harnessWith(gateway);

    await harness.deliver(envelope);
    const second = await harness.deliver(envelope);

    expect(second).toEqual(ACKED);
    expect(gateway.callsOf('createRefund')).toHaveLength(1);
    expect(await requestRow(refundRequestId)).toMatchObject({
      status: 'submitted',
      stripeRefundId: STRIPE_REFUND_ID,
    });
  });

  test.each(['submitted', 'succeeded'] as const)(
    '%sの依頼はStripeを呼ばずに終える',
    async (status) => {
      await insertPurchase(1);
      await insertRefundRequest(1, status);
      const gateway = refundingGateway();
      const harness = harnessWith(gateway);

      const outcome = await harness.deliver(envelopeOf(refundIdOf(1)));

      expect(outcome).toEqual(ACKED);
      expect(gateway.calls).toEqual([]);
      expect((await requestRow(refundIdOf(1)))?.status).toBe(status);
      expect(harness.incidents).toEqual([]);
    },
  );

  test('Stripeの返金の通知が先に反映した依頼の状態を、提出済みへ戻さない', async () => {
    await insertPurchase(1);
    const { refundRequestId, envelope } = await requestRefund();
    const gateway = refundingGateway({
      createRefund: async (input) => {
        await refunds.updateStatus({
          refundRequestId,
          status: 'succeeded',
          stripeRefundId: STRIPE_REFUND_ID,
        });
        return refundSnapshotOf(
          { amount: input.amount ?? PAID },
          { status: 'succeeded' },
        );
      },
    });
    const harness = harnessWith(gateway);

    await harness.deliver(envelope);

    expect(await requestRow(refundRequestId)).toMatchObject({
      status: 'succeeded',
      stripeRefundId: STRIPE_REFUND_ID,
    });
  });

  test('存在しない依頼のメッセージは、Stripeを呼ばずに終える', async () => {
    const gateway = refundingGateway();
    const harness = harnessWith(gateway);

    const outcome = await harness.deliver(envelopeOf(refundIdOf(9)));

    expect(outcome).toEqual(ACKED);
    expect(gateway.calls).toEqual([]);
    expect(harness.incidents).toEqual([]);
  });
});

describe('返金の処理の失敗', () => {
  test('購入のPaymentIntentのIDが無い依頼は、Stripeを呼ばずに失敗として記録して知らせる', async () => {
    await insertPurchase(1, { paymentIntentId: null });
    await insertRefundRequest(1);
    const gateway = refundingGateway();
    const harness = harnessWith(gateway);

    const outcome = await harness.deliver(envelopeOf(refundIdOf(1)));

    expect(outcome).toEqual(ACKED);
    expect(gateway.calls).toEqual([]);
    expect(await requestRow(refundIdOf(1))).toMatchObject({
      status: 'failed',
      failureCode: 'missing_payment_intent',
      stripeRefundId: null,
    });
    expect(harness.incidents).toEqual([
      { kind: 'missing-payment-intent', refundRequestId: refundIdOf(1) },
    ]);
  });

  test('購入が見つからない依頼は、Stripeを呼ばずに失敗として記録して知らせる', async () => {
    await insertPurchase(1);
    await insertRefundRequest(1);
    const gateway = refundingGateway();
    const harness = harnessWith(gateway, new MissingPurchaseStore(db));

    const outcome = await harness.deliver(envelopeOf(refundIdOf(1)));

    expect(outcome).toEqual(ACKED);
    expect(gateway.calls).toEqual([]);
    expect(await requestRow(refundIdOf(1))).toMatchObject({
      status: 'failed',
      failureCode: 'missing_payment_intent',
    });
    expect(harness.incidents).toEqual([
      { kind: 'missing-payment-intent', refundRequestId: refundIdOf(1) },
    ]);
  });

  test('一時的な失敗は60秒から倍の間隔で再試行し、5回目の失敗でデッドレターへ移して依頼を残す', async () => {
    await insertPurchase(1);
    const { refundRequestId, envelope } = await requestRefund();
    const gateway = refundingGateway({
      createRefund: () =>
        Promise.reject(new StripeUnavailableError('一時的な失敗')),
    });
    const harness = harnessWith(gateway);

    const outcomes = [];
    for (const attempts of [1, 2, 3, 4, 5]) {
      outcomes.push(await harness.deliver(envelope, attempts));
    }

    expect(outcomes).toEqual([
      { acked: false, retried: true, delaySeconds: 60 },
      { acked: false, retried: true, delaySeconds: 120 },
      { acked: false, retried: true, delaySeconds: 240 },
      { acked: false, retried: true, delaySeconds: 480 },
      ACKED,
    ]);
    expect(harness.deadLetters).toEqual([
      expect.objectContaining({
        messageId: envelope.id,
        type: 'payments.refund-payment',
        attempts: 5,
        reason: 'handler-failed',
        errorName: 'StripeUnavailableError',
      }),
    ]);
    expect(await requestRow(refundRequestId)).toMatchObject({
      status: 'requested',
      stripeRefundId: null,
    });
    expect(harness.incidents).toEqual([]);
  });

  test('Stripeが返金を恒久的に拒否したら、再試行せずに拒否のコードを失敗として記録して知らせる', async () => {
    await insertPurchase(1);
    const { refundRequestId, envelope } = await requestRefund();
    const gateway = refundingGateway({
      createRefund: () =>
        Promise.reject(
          new StripeRejectedError({
            message: 'Stripeが操作を拒否しました',
            stripeErrorCode: 'charge_already_refunded',
          }),
        ),
    });
    const harness = harnessWith(gateway);

    const outcome = await harness.deliver(envelope);

    expect(outcome).toEqual(ACKED);
    expect(harness.deadLetters).toEqual([]);
    expect(await requestRow(refundRequestId)).toMatchObject({
      status: 'failed',
      failureCode: 'charge_already_refunded',
      stripeRefundId: null,
    });
    expect(harness.incidents).toEqual([
      {
        kind: 'stripe-rejected',
        refundRequestId,
        operation: 'create_refund',
        stripeErrorCode: 'charge_already_refunded',
      },
    ]);
  });

  test('失敗として記録した依頼のメッセージが再び届いても、Stripeを呼ばず重ねて知らせない', async () => {
    await insertPurchase(1);
    const { envelope } = await requestRefund();
    const gateway = refundingGateway({
      createRefund: () =>
        Promise.reject(
          new StripeRejectedError({
            message: 'Stripeが操作を拒否しました',
            stripeErrorCode: 'charge_disputed',
          }),
        ),
    });
    const harness = harnessWith(gateway);

    await harness.deliver(envelope);
    await harness.deliver(envelope);

    expect(gateway.callsOf('createRefund')).toHaveLength(1);
    expect(harness.incidents).toHaveLength(1);
  });

  test('定期課金の解約が恒久的に拒否されたら、返金を作らずに失敗として記録して知らせる', async () => {
    const { refundRequestId, envelope } = await requestReflectionRefund({
      reason: 'late',
      subscriptionId: SUBSCRIPTION_ID,
    });
    const gateway = refundingGateway({
      cancelSubscription: () =>
        Promise.reject(
          new StripeRejectedError({
            message: 'Stripeが操作を拒否しました',
            stripeErrorCode: 'subscription_cancel_rejected',
          }),
        ),
    });
    const harness = harnessWith(gateway);

    const outcome = await harness.deliver(envelope);

    expect(outcome).toEqual(ACKED);
    expect(gateway.callsOf('createRefund')).toEqual([]);
    expect(await requestRow(refundRequestId)).toMatchObject({
      status: 'failed',
      failureCode: 'subscription_cancel_rejected',
    });
    expect(harness.incidents).toEqual([
      {
        kind: 'stripe-rejected',
        refundRequestId,
        operation: 'cancel_subscription',
        stripeErrorCode: 'subscription_cancel_rejected',
      },
    ]);
  });

  test('定期課金の解約の一時的な失敗は、返金を作らずに再試行する', async () => {
    const { refundRequestId, envelope } = await requestReflectionRefund({
      reason: 'late',
      subscriptionId: SUBSCRIPTION_ID,
    });
    const gateway = refundingGateway({
      cancelSubscription: () =>
        Promise.reject(new StripeUnavailableError('一時的な失敗')),
    });
    const harness = harnessWith(gateway);

    const outcome = await harness.deliver(envelope);

    expect(outcome).toEqual({ acked: false, retried: true, delaySeconds: 60 });
    expect(gateway.callsOf('createRefund')).toEqual([]);
    expect((await requestRow(refundRequestId))?.status).toBe('requested');
  });
});
