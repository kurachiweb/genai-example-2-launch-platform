import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
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

import type { PurchaseStatus } from '../../common-lib/payments/purchase-states.ts';
import { users } from '../../db/schema/identity/users.ts';
import { paymentCustomers } from '../../db/schema/payments/payment-customers.ts';
import { paymentPurchases } from '../../db/schema/payments/payment-purchases.ts';
import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import { createUlidGenerator } from '../../lib/core/ids/id-generator.ts';
import {
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  USER_LIFECYCLE_RETRY_POLICY,
  type UserLifecycleAsyncHandler,
  type UserLifecycleAsyncRegistration,
  type UserLifecycleEventType,
} from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { PAYMENTS_TYPES } from '../../lib/core/payments/identifiers.ts';
import {
  type CustomerStore,
  type OpenCheckoutExpirer,
  type StripeGateway,
  StripeUnavailableError,
} from '../../lib/core/payments/ports.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import { D1CustomerStore } from '../../lib/workers/payments/d1-customer-store.ts';
import { D1PaymentRecordStore } from '../../lib/workers/payments/d1-payment-record-store.ts';
import { D1PurchaseStore } from '../../lib/workers/payments/d1-purchase-store.ts';
import { D1RefundStore } from '../../lib/workers/payments/d1-refund-store.ts';
import { StripeOpenCheckoutExpirer } from '../../lib/workers/payments/open-checkout-expirer.ts';
import {
  harnessWith as reflectionHarnessWith,
  insertPurchase,
  NOW,
  sessionIdOf,
} from '../../lib/workers/payments/testing/checkout-reflection-harness.ts';
import {
  createFakeStripeGateway,
  type FakeStripeGateway,
} from '../../lib/workers/payments/testing/fake-stripe-gateway.ts';
import {
  clearPaymentTables,
  db,
  insertUser,
  newPaymentRecord,
  newRefundRequest,
  purchaseIdOf,
  readRecords,
  recordIdOf,
  refundIdOf,
  T0,
  userIdOf,
} from '../../lib/workers/payments/testing/payment-store-fixtures.ts';
import {
  eventIdOf,
  insertEvent,
  readEvent,
  readHandlerRuns,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { EVENT_IDENTITY_TYPES } from '../application/identity/event-identity-types.ts';
import { CustomerErasureHandler } from '../application/payments/customer-erasure-handler.ts';
import { EVENT_PAYMENTS_TYPES } from '../application/payments/event-payments-types.ts';
import { OpenCheckoutExpiryHandler } from '../application/payments/open-checkout-expiry-handler.ts';
import type { PaymentAccountDataEraser } from '../application/payments/payment-account-data-eraser.ts';
import { D1PaymentAccountDataEraser } from '../infrastructure/payments/d1-payment-account-data-eraser.ts';
import { createEventIdentityModule } from './identity-module.ts';

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
  readonly retryDelaySeconds?: number;
  readonly resentDelaySeconds?: number;
}

interface UserPaymentRows {
  readonly customerIds: readonly string[];
  readonly purchaseIds: readonly string[];
  readonly refundIds: readonly string[];
}

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const CUSTOMER_ERASURE = 'payments.customer-erasure';

const OPEN_CHECKOUT_EXPIRY = 'payments.open-checkout-expiry';

// ライフサイクルの登録箇所への登録は決済のモジュールと同じ変更で行うため、ここでは設計の名前・順序の登録で実行器から呼ぶ
const REGISTRATIONS: readonly UserLifecycleAsyncRegistration[] = [
  {
    name: CUSTOMER_ERASURE,
    events: ['purge_due'],
    order: 400,
    handler: EVENT_PAYMENTS_TYPES.CustomerErasureHandler,
  },
  {
    name: OPEN_CHECKOUT_EXPIRY,
    events: ['withdrawn', 'suspended'],
    order: 410,
    handler: EVENT_PAYMENTS_TYPES.OpenCheckoutExpiryHandler,
  },
];

const TARGET = 1;

const KEPT = 2;

const LIFECYCLE_EVENT = 40;

const TARGET_CUSTOMER_ID = 'cus_test_lifecycle_1';

const KEPT_CUSTOMER_ID = 'cus_test_lifecycle_2';

const KEPT_PURCHASE = 900;

const purchases = new D1PurchaseStore(db);
const refunds = new D1RefundStore(db);
const customers = new D1CustomerStore(db);
const records = new D1PaymentRecordStore(db);

let envelopeCount = 0;

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function envelopeOf(eventIndex: number): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type: RUN_USER_LIFECYCLE_MESSAGE.type,
    id: `01JC0MSG${String(envelopeCount).padStart(18, '0')}`,
    sentAt: T0.toISOString(),
    body: { eventId: eventIdOf(eventIndex) },
  };
}

function paymentsBindings(gateway: StripeGateway): ContainerModule {
  const clock = { now: () => NOW };
  const expirer = new StripeOpenCheckoutExpirer({
    appName: 'event',
    gateway,
    purchases,
    reflection: reflectionHarnessWith({
      gateway: createFakeStripeGateway(),
    }).reflection,
    ids: createUlidGenerator(clock),
    clock,
  });
  return new ContainerModule(({ bind }) => {
    bind(PAYMENTS_TYPES.PurchaseStatements).to(D1PurchaseStore);
    bind(PAYMENTS_TYPES.RefundStatements).to(D1RefundStore);
    bind(PAYMENTS_TYPES.CustomerStatements).to(D1CustomerStore);
    bind<CustomerStore>(PAYMENTS_TYPES.CustomerStore).to(D1CustomerStore);
    bind<StripeGateway>(PAYMENTS_TYPES.StripeGateway).toConstantValue(gateway);
    bind<OpenCheckoutExpirer>(
      PAYMENTS_TYPES.OpenCheckoutExpirer,
    ).toConstantValue(expirer);
    bind<PaymentAccountDataEraser>(
      EVENT_PAYMENTS_TYPES.PaymentAccountDataEraser,
    ).to(D1PaymentAccountDataEraser);
    bind<UserLifecycleAsyncHandler>(
      EVENT_PAYMENTS_TYPES.CustomerErasureHandler,
    ).to(CustomerErasureHandler);
    bind<UserLifecycleAsyncHandler>(
      EVENT_PAYMENTS_TYPES.OpenCheckoutExpiryHandler,
    ).to(OpenCheckoutExpiryHandler);
  });
}

// 本番と同じQueueのconsumerとライフサイクルの実行器から波及処理を呼び、Stripeだけを偽物にする
async function deliver(
  gateway: StripeGateway,
  envelope: QueueEnvelope,
  attempts = 1,
): Promise<MessageOutcome> {
  const dispatcher = createQueueDispatcher(
    [
      {
        contract: RUN_USER_LIFECYCLE_MESSAGE,
        handler: EVENT_IDENTITY_TYPES.UserLifecycleRunner,
        retry: USER_LIFECYCLE_RETRY_POLICY,
      },
    ],
    [
      createEventIdentityModule({ asyncHandlers: REGISTRATIONS }),
      { bindings: paymentsBindings(gateway) },
    ],
  );
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: T0, attempts, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const retrySpy = vi.spyOn(message, 'retry');
  // 送り直したメッセージが後のテストの途中で届かないよう、実際には送らない
  const resendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  const ctx = createExecutionContext();
  try {
    await dispatcher.dispatch(batch, env, ctx);
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    expect(deadLetterSpy).not.toHaveBeenCalled();
    const retried = retryMessages.some(({ msgId }) => msgId === message.id);
    const retryDelaySeconds = retrySpy.mock.calls.at(-1)?.[0]?.delaySeconds;
    const resentDelaySeconds = resendSpy.mock.calls.at(-1)?.[1]?.delaySeconds;
    return {
      acked: explicitAcks.includes(message.id),
      retried,
      ...(retried && retryDelaySeconds !== undefined
        ? { retryDelaySeconds }
        : {}),
      ...(resentDelaySeconds === undefined ? {} : { resentDelaySeconds }),
    };
  } finally {
    resendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

async function readUserPaymentRows(
  userIndex: number,
): Promise<UserPaymentRows> {
  const userId = userIdOf(userIndex);
  const customerRows = await db
    .select({ id: paymentCustomers.stripeCustomerId })
    .from(paymentCustomers)
    .where(eq(paymentCustomers.userId, userId));
  const purchaseRows = await db
    .select({ id: paymentPurchases.id })
    .from(paymentPurchases)
    .where(eq(paymentPurchases.userId, userId))
    .orderBy(asc(paymentPurchases.id));
  const refundRows = await db
    .select({ id: paymentRefunds.id })
    .from(paymentRefunds)
    .innerJoin(
      paymentPurchases,
      eq(paymentPurchases.id, paymentRefunds.purchaseId),
    )
    .where(eq(paymentPurchases.userId, userId))
    .orderBy(asc(paymentRefunds.id));
  return {
    customerIds: customerRows.map(({ id }) => id),
    purchaseIds: purchaseRows.map(({ id }) => id),
    refundIds: refundRows.map(({ id }) => id),
  };
}

async function userRowExists(userIndex: number): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userIdOf(userIndex)));
  return rows.length === 1;
}

async function statusesOf(
  userIndex: number,
): Promise<Readonly<Record<string, PurchaseStatus>>> {
  const rows = await db
    .select({ id: paymentPurchases.id, status: paymentPurchases.status })
    .from(paymentPurchases)
    .where(eq(paymentPurchases.userId, userIdOf(userIndex)));
  return Object.fromEntries(rows.map(({ id, status }) => [id, status]));
}

async function readRecordIds(): Promise<readonly string[]> {
  return (await readRecords()).map(({ id }) => id);
}

const TARGET_PAYMENT_ROWS: UserPaymentRows = {
  customerIds: [TARGET_CUSTOMER_ID],
  purchaseIds: [purchaseIdOf(1), purchaseIdOf(2)],
  refundIds: [refundIdOf(1)],
};

const KEPT_PAYMENT_ROWS: UserPaymentRows = {
  customerIds: [KEPT_CUSTOMER_ID],
  purchaseIds: [purchaseIdOf(KEPT_PURCHASE)],
  refundIds: [refundIdOf(2)],
};

const NO_ROWS: UserPaymentRows = {
  customerIds: [],
  purchaseIds: [],
  refundIds: [],
};

const ALL_RECORD_IDS = [
  recordIdOf(1),
  recordIdOf(2),
  recordIdOf(KEPT_PURCHASE),
];

// 物理削除の時期を迎えた退会者に、Customerの対応・2件の購入・返金の依頼・決済履歴を、行が残るべき別の利用者に1件ずつを入れる
async function arrangeWithdrawnUserWithPayments(): Promise<void> {
  await insertUser(TARGET, { deletedAt: T0 });
  await insertUser(KEPT);
  await customers.save(userIdOf(TARGET), TARGET_CUSTOMER_ID);
  await customers.save(userIdOf(KEPT), KEPT_CUSTOMER_ID);
  await insertPurchase(1);
  await insertPurchase(2);
  await insertPurchase(KEPT_PURCHASE, { userId: userIdOf(KEPT) });
  await db.batch([
    refunds.insert(newRefundRequest(1, { purchaseId: purchaseIdOf(1) })),
    refunds.insert(
      newRefundRequest(2, { purchaseId: purchaseIdOf(KEPT_PURCHASE) }),
    ),
  ]);
  await db.batch([
    records.upsertByReference(newPaymentRecord(1)),
    records.upsertByReference(newPaymentRecord(2)),
    records.upsertByReference(
      newPaymentRecord(KEPT_PURCHASE, { pseudonymousId: 'pseudonymous-2' }),
    ),
  ]);
  await insertEvent(LIFECYCLE_EVENT, {
    userId: userIdOf(TARGET),
    type: 'purge_due',
  });
}

function deletingGateway(
  result: 'deleted' | 'already_deleted' = 'deleted',
): FakeStripeGateway {
  return createFakeStripeGateway({
    deleteCustomer: () => Promise.resolve(result),
  });
}

function deletedCustomerIds(gateway: FakeStripeGateway): readonly unknown[] {
  return gateway.callsOf('deleteCustomer').map(({ args }) => args[0]);
}

async function arrangeOpenPurchases(
  type: UserLifecycleEventType,
  count: number,
): Promise<void> {
  await insertUser(TARGET, type === 'withdrawn' ? { deletedAt: T0 } : {});
  await insertUser(KEPT);
  for (let index = 1; index <= count; index += 1) {
    await insertPurchase(index);
  }
  await insertPurchase(KEPT_PURCHASE, { userId: userIdOf(KEPT) });
  await insertEvent(LIFECYCLE_EVENT, { userId: userIdOf(TARGET), type });
}

function expiringGateway(): FakeStripeGateway {
  return createFakeStripeGateway({
    expireCheckoutSession: () => Promise.resolve('expired'),
  });
}

function expiredSessionIds(gateway: FakeStripeGateway): readonly unknown[] {
  return gateway.callsOf('expireCheckoutSession').map(({ args }) => args[0]);
}

function statusesFor(
  indexes: readonly number[],
  status: PurchaseStatus,
): Readonly<Record<string, PurchaseStatus>> {
  return Object.fromEntries(
    indexes.map((index) => [purchaseIdOf(index), status]),
  );
}

function indexesFrom(first: number, last: number): readonly number[] {
  return Array.from(
    { length: last - first + 1 },
    (_, offset) => first + offset,
  );
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

describe('物理削除の開始でのCustomerの削除', () => {
  test('Customerを削除し、返金の依頼・購入・Customerの対応を消して決済履歴を残し、利用者の行まで物理削除する', async () => {
    await arrangeWithdrawnUserWithPayments();
    const gateway = deletingGateway();
    const envelope = envelopeOf(LIFECYCLE_EVENT);

    await expect(deliver(gateway, envelope)).resolves.toStrictEqual({
      acked: true,
      retried: false,
    });

    expect(deletedCustomerIds(gateway)).toStrictEqual([TARGET_CUSTOMER_ID]);
    await expect(readUserPaymentRows(TARGET)).resolves.toStrictEqual(NO_ROWS);
    await expect(readUserPaymentRows(KEPT)).resolves.toStrictEqual(
      KEPT_PAYMENT_ROWS,
    );
    await expect(readRecordIds()).resolves.toStrictEqual(ALL_RECORD_IDS);
    await expect(userRowExists(TARGET)).resolves.toBe(false);
    await expect(readEvent(LIFECYCLE_EVENT)).resolves.toBeUndefined();

    await expect(deliver(gateway, envelope)).resolves.toStrictEqual({
      acked: true,
      retried: false,
    });
    expect(deletedCustomerIds(gateway)).toStrictEqual([TARGET_CUSTOMER_ID]);
    await expect(userRowExists(KEPT)).resolves.toBe(true);
  });

  test('Stripe上に既にCustomerが無ければ削除済みとして扱い、物理削除を完了させる', async () => {
    await arrangeWithdrawnUserWithPayments();
    const gateway = deletingGateway('already_deleted');

    await expect(
      deliver(gateway, envelopeOf(LIFECYCLE_EVENT)),
    ).resolves.toStrictEqual({ acked: true, retried: false });

    expect(deletedCustomerIds(gateway)).toStrictEqual([TARGET_CUSTOMER_ID]);
    await expect(readUserPaymentRows(TARGET)).resolves.toStrictEqual(NO_ROWS);
    await expect(readRecordIds()).resolves.toStrictEqual(ALL_RECORD_IDS);
    await expect(userRowExists(TARGET)).resolves.toBe(false);
  });

  test('Stripeの一時的な失敗では利用者の行を消さずに再試行し、再試行で物理削除を完了させる', async () => {
    await arrangeWithdrawnUserWithPayments();
    const envelope = envelopeOf(LIFECYCLE_EVENT);
    const failing = createFakeStripeGateway({
      deleteCustomer: () =>
        Promise.reject(new StripeUnavailableError('Stripeの障害')),
    });

    await expect(deliver(failing, envelope)).resolves.toStrictEqual({
      acked: false,
      retried: true,
      retryDelaySeconds: USER_LIFECYCLE_RETRY_POLICY.baseDelaySeconds,
    });
    await expect(readUserPaymentRows(TARGET)).resolves.toStrictEqual(
      TARGET_PAYMENT_ROWS,
    );
    await expect(userRowExists(TARGET)).resolves.toBe(true);
    await expect(readHandlerRuns()).resolves.toEqual([]);
    await expect(readEvent(LIFECYCLE_EVENT)).resolves.toMatchObject({
      status: 'pending',
    });

    const recovered = deletingGateway();
    await expect(deliver(recovered, envelope, 2)).resolves.toStrictEqual({
      acked: true,
      retried: false,
    });
    expect(deletedCustomerIds(recovered)).toStrictEqual([TARGET_CUSTOMER_ID]);
    await expect(readUserPaymentRows(TARGET)).resolves.toStrictEqual(NO_ROWS);
    await expect(userRowExists(TARGET)).resolves.toBe(false);
  });

  test('Customerの対応が無い利用者は、Stripeを呼ばずに物理削除を完了させる', async () => {
    await insertUser(TARGET, { deletedAt: T0 });
    await insertPurchase(1);
    await insertEvent(LIFECYCLE_EVENT, {
      userId: userIdOf(TARGET),
      type: 'purge_due',
    });
    const gateway = createFakeStripeGateway();

    await expect(
      deliver(gateway, envelopeOf(LIFECYCLE_EVENT)),
    ).resolves.toStrictEqual({ acked: true, retried: false });

    expect(gateway.calls).toStrictEqual([]);
    await expect(readUserPaymentRows(TARGET)).resolves.toStrictEqual(NO_ROWS);
    await expect(userRowExists(TARGET)).resolves.toBe(false);
  });
});

describe('退会・停止での未完了の決済セッションの失効', () => {
  test.each(['withdrawn', 'suspended'] as const)(
    '%sのイベントで、利用者の未完了の決済セッションを失効させ、他の利用者の購入は変えない',
    async (type) => {
      await arrangeOpenPurchases(type, 2);
      const gateway = expiringGateway();

      await expect(
        deliver(gateway, envelopeOf(LIFECYCLE_EVENT)),
      ).resolves.toStrictEqual({ acked: true, retried: false });

      expect(expiredSessionIds(gateway)).toStrictEqual([
        sessionIdOf(1),
        sessionIdOf(2),
      ]);
      await expect(statusesOf(TARGET)).resolves.toStrictEqual(
        statusesFor([1, 2], 'expired'),
      );
      await expect(statusesOf(KEPT)).resolves.toStrictEqual(
        statusesFor([KEPT_PURCHASE], 'open'),
      );
      await expect(readEvent(LIFECYCLE_EVENT)).resolves.toMatchObject({
        status: 'completed',
      });
    },
  );

  test('上限の50件を超える未完了の決済セッションは、続きを返して次のメッセージで残りを失効させる', async () => {
    await arrangeOpenPurchases('withdrawn', 51);
    const envelope = envelopeOf(LIFECYCLE_EVENT);
    const gateway = expiringGateway();

    await expect(deliver(gateway, envelope)).resolves.toStrictEqual({
      acked: true,
      retried: false,
      resentDelaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    expect(expiredSessionIds(gateway)).toHaveLength(50);
    const afterFirst = await statusesOf(TARGET);
    expect(
      Object.values(afterFirst).filter((status) => status === 'open'),
    ).toHaveLength(1);
    await expect(readHandlerRuns()).resolves.toEqual([]);
    await expect(readEvent(LIFECYCLE_EVENT)).resolves.toMatchObject({
      status: 'pending',
    });

    await expect(deliver(gateway, envelope)).resolves.toStrictEqual({
      acked: true,
      retried: false,
    });
    expect(expiredSessionIds(gateway)).toHaveLength(51);
    await expect(statusesOf(TARGET)).resolves.toStrictEqual(
      statusesFor(indexesFrom(1, 51), 'expired'),
    );
    await expect(readHandlerRuns()).resolves.toMatchObject([
      {
        eventId: eventIdOf(LIFECYCLE_EVENT),
        handlerName: OPEN_CHECKOUT_EXPIRY,
      },
    ]);
    await expect(readEvent(LIFECYCLE_EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('Stripeの一時的な失敗では購入を未完了のまま残して再試行し、再試行で失効させる', async () => {
    await arrangeOpenPurchases('suspended', 1);
    const envelope = envelopeOf(LIFECYCLE_EVENT);
    const failing = createFakeStripeGateway({
      expireCheckoutSession: () =>
        Promise.reject(new StripeUnavailableError('Stripeの障害')),
    });

    await expect(deliver(failing, envelope)).resolves.toStrictEqual({
      acked: false,
      retried: true,
      retryDelaySeconds: USER_LIFECYCLE_RETRY_POLICY.baseDelaySeconds,
    });
    await expect(statusesOf(TARGET)).resolves.toStrictEqual(
      statusesFor([1], 'open'),
    );
    await expect(readEvent(LIFECYCLE_EVENT)).resolves.toMatchObject({
      status: 'pending',
    });

    await expect(
      deliver(expiringGateway(), envelope, 2),
    ).resolves.toStrictEqual({ acked: true, retried: false });
    await expect(statusesOf(TARGET)).resolves.toStrictEqual(
      statusesFor([1], 'expired'),
    );
  });
});
