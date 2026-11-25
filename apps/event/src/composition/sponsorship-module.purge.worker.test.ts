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
import type { Container } from 'inversify';
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

import { paymentRecords } from '../../db/schema/payments/payment-records.ts';
import { users } from '../../db/schema/identity/users.ts';
import { products } from '../../db/schema/product/products.ts';
import type {
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/product.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import type {
  ProductLifecycleAsyncHandler,
  ProductLifecycleEvent,
} from '../../lib/core/product/product-lifecycle.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  eventIdOf,
  insertEvent,
  readEvent,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  insertProductEvent,
  productEventIdOf,
  readProductEvent,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import {
  clearSponsorshipTables,
  db,
  displayStopIdOf,
  insertDisplayStops,
  insertSponsorProduct,
  insertSponsorshipPurchase,
  insertSponsorships,
  insertSponsorUser,
  NOW,
  paidColumnsOf,
  productIdOf,
  readDisplayStopRows,
  readSponsorshipIds,
  sponsorshipIdOf,
  sponsorshipPaymentRecordIdOf,
  sponsorshipPurchaseIdOf,
  T0,
  userIdOf,
} from '../../lib/workers/sponsorship/testing/sponsorship-fixtures.ts';
import { EVENT_IDENTITY_TYPES } from '../application/identity/event-identity-types.ts';
import type { IdentityPurgeStore } from '../application/identity/ports.ts';
import { EVENT_PRODUCT_TYPES } from '../application/product/event-product-types.ts';
import type { ProductPurgeStore } from '../application/product/ports.ts';
import { EVENT_SPONSORSHIP_TYPES } from '../application/sponsorship/event-sponsorship-types.ts';
import worker from '../index.ts';
import { MODULES } from './modules.ts';

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
  readonly resent: boolean;
  readonly productEnvelopes: readonly QueueEnvelope[];
}

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const OWNER = 1;

const OTHER_OWNER = 2;

// プロダクトを持たない申込者。利用者の外部キーだけを確かめるため、他の利用者のプロダクトへの申込の行を作る
const APPLICANT = 3;

// 利用者1のプロダクト1と、利用者2のプロダクト2
const OWNED = 1;

const OTHERS = 2;

const PURGE_EVENT = 10;

const ENVELOPE_PREFIX = '01JD0SPPRG';

let envelopeCount = 0;

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'queue',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function lifecycleEnvelope(type: string, eventId: string): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type,
    id: `${ENVELOPE_PREFIX}${String(envelopeCount).padStart(16, '0')}`,
    sentAt: NOW.toISOString(),
    body: { eventId },
  };
}

function isEnvelopeOf(type: string, sent: unknown): sent is QueueEnvelope {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === type
  );
}

// 本番と同じエントリのqueueハンドラーで処理する。送り直しと送信は実際には送らず、送られた封筒を集めて後で同じハンドラーへ渡す
async function dispatch(envelope: QueueEnvelope): Promise<MessageOutcome> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: NOW, attempts: 1, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const { queue } = worker;
  if (queue === undefined) {
    throw new Error('イベントサーバーのエントリにqueueハンドラーが無い');
  }
  const sendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  const ctx = createExecutionContext();
  try {
    await queue(batch, env, ctx);
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    expect(deadLetterSpy).not.toHaveBeenCalled();
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      resent: sendSpy.mock.calls.some(([sent]) =>
        isEnvelopeOf(envelope.type, sent),
      ),
      productEnvelopes: sendSpy.mock.calls.flatMap(([sent]) =>
        isEnvelopeOf(RUN_PRODUCT_LIFECYCLE_MESSAGE.type, sent) ? [sent] : [],
      ),
    };
  } finally {
    sendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

function userPurgeEvent(user: number): UserLifecycleEvent {
  return {
    id: eventIdOf(PURGE_EVENT),
    userId: userIdOf(user),
    type: 'purge_due',
    occurredAt: NOW,
  };
}

function productPurgeEvent(product: number): ProductLifecycleEvent {
  return {
    id: productEventIdOf(PURGE_EVENT),
    productId: productIdOf(product),
    ownerUserId: userIdOf(OWNER),
    type: 'purge_due',
    occurredAt: NOW,
  };
}

async function rowExists(
  table: typeof users | typeof products,
  id: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, id));
  return rows.length === 1;
}

async function readDisplayStopIds(): Promise<string[]> {
  const rows = await readDisplayStopRows();
  return rows.map(({ id }) => id);
}

async function readPaymentRecordIds(): Promise<string[]> {
  const rows = await db
    .select({ id: paymentRecords.id })
    .from(paymentRecords)
    .orderBy(asc(paymentRecords.id));
  return rows.map(({ id }) => id);
}

// 決済の機能が記録した決済履歴の行を、テストのためだけに直接作る
async function insertPaymentRecord(index: number): Promise<void> {
  await db.insert(paymentRecords).values({
    id: sponsorshipPaymentRecordIdOf(index),
    pseudonymousId: `pseudonym-${String(index)}`,
    kind: 'one_time',
    purpose: 'sponsorship',
    status: 'succeeded',
    amount: 7_000,
    currency: 'usd',
    quantity: 7,
    stripeReference: `pi_test_sponsorship_${String(index)}`,
    relatedId: sponsorshipIdOf(index),
    purchaseId: sponsorshipPurchaseIdOf(index),
    occurredAt: T0,
    lastEventAt: T0,
    recordedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
}

const PAYMENT_RECORD_IDS = [1, 2, 3].map(sponsorshipPaymentRecordIdOf);

// 申込1は利用者1のプロダクト1への決済済み、2は利用者2のプロダクト2への決済済み、3は申込者3のプロダクト2への決済済みの申込。
// 表示停止の区間1はプロダクト1、2は利用者1、3はプロダクト2、4は申込者3のもの
async function seedSponsorships(): Promise<void> {
  await clearSponsorshipTables();
  await insertSponsorUser(OWNER, 'withdrawn');
  await insertSponsorUser(OTHER_OWNER);
  await insertSponsorUser(APPLICANT, 'withdrawn');
  await insertSponsorProduct({ index: OWNED, owner: OWNER, state: 'deleted' });
  await insertSponsorProduct({ index: OTHERS, owner: OTHER_OWNER });
  await insertSponsorships([
    { index: 1, owner: OWNER, product: OWNED, columns: paidColumnsOf(1) },
    {
      index: 2,
      owner: OTHER_OWNER,
      product: OTHERS,
      columns: paidColumnsOf(2),
    },
    { index: 3, owner: APPLICANT, product: OTHERS, columns: paidColumnsOf(3) },
  ]);
  await insertSponsorshipPurchase({ index: 1, owner: OWNER });
  await insertSponsorshipPurchase({ index: 2, owner: OTHER_OWNER });
  for (const index of [1, 2, 3]) {
    await insertPaymentRecord(index);
  }
  await insertDisplayStops([
    {
      index: 1,
      subject: { kind: 'product', productId: productIdOf(OWNED) },
      startedAt: NOW,
    },
    {
      index: 2,
      subject: { kind: 'user', userId: userIdOf(OWNER) },
      startedAt: NOW,
    },
    {
      index: 3,
      subject: { kind: 'product', productId: productIdOf(OTHERS) },
      startedAt: NOW,
    },
    {
      index: 4,
      subject: { kind: 'user', userId: userIdOf(APPLICANT) },
      startedAt: NOW,
    },
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await seedSponsorships();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('プロダクトの物理削除による申込の削除(sponsorship.product-purge)', () => {
  test('申込が残る間はproduct-launchの物理削除が外部キーで失敗し、処理の後に成功する。同じイベントで2回動いても結果が同じ', async () => {
    const container = createContainer();
    const purgeStore = container.get<ProductPurgeStore>(
      EVENT_PRODUCT_TYPES.ProductPurgeStore,
    );
    const handler = container.get<ProductLifecycleAsyncHandler>(
      EVENT_SPONSORSHIP_TYPES.ProductPurgeHandler,
    );

    await expect(purgeStore.purge(productIdOf(OWNED))).rejects.toThrow(
      /FOREIGN KEY constraint failed/u,
    );

    await expect(handler.handle(productPurgeEvent(OWNED))).resolves.toEqual({
      kind: 'done',
    });
    const sponsorshipsAfterFirst = await readSponsorshipIds();
    const stopsAfterFirst = await readDisplayStopIds();
    await expect(handler.handle(productPurgeEvent(OWNED))).resolves.toEqual({
      kind: 'done',
    });

    await expect(readSponsorshipIds()).resolves.toStrictEqual(
      sponsorshipsAfterFirst,
    );
    await expect(readDisplayStopIds()).resolves.toStrictEqual(stopsAfterFirst);
    await purgeStore.purge(productIdOf(OWNED));
    await expect(rowExists(products, productIdOf(OWNED))).resolves.toBe(false);
  });

  test('プロダクトの物理削除の時期の到来の処理が、申込とプロダクトの表示停止の区間を消してプロダクトを消し、決済履歴と他のプロダクト・利用者の行を残す', async () => {
    await insertProductEvent(PURGE_EVENT, OWNED, {
      ownerUserId: userIdOf(OWNER),
      type: 'purge_due',
    });

    const outcome = await dispatch(
      lifecycleEnvelope(
        RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        productEventIdOf(PURGE_EVENT),
      ),
    );

    expect(outcome).toMatchObject({ acked: true, retried: false });
    await expect(rowExists(products, productIdOf(OWNED))).resolves.toBe(false);
    await expect(readProductEvent(PURGE_EVENT)).resolves.toBeUndefined();
    await expect(readSponsorshipIds()).resolves.toStrictEqual(
      [2, 3].map(sponsorshipIdOf),
    );
    await expect(readDisplayStopIds()).resolves.toStrictEqual(
      [2, 3, 4].map(displayStopIdOf),
    );
    await expect(readPaymentRecordIds()).resolves.toStrictEqual(
      PAYMENT_RECORD_IDS,
    );
    await expect(rowExists(products, productIdOf(OTHERS))).resolves.toBe(true);
    await expect(rowExists(users, userIdOf(OWNER))).resolves.toBe(true);
  });
});

describe('利用者の物理削除による申込の削除(sponsorship.account-purge)', () => {
  test('申込が残る間はidentity-authの物理削除が外部キーで失敗し、処理の後に成功する。同じイベントで2回動いても結果が同じ', async () => {
    const container = createContainer();
    const purgeStore = container.get<IdentityPurgeStore>(
      EVENT_IDENTITY_TYPES.IdentityPurgeStore,
    );
    const handler = container.get<UserLifecycleAsyncHandler>(
      EVENT_SPONSORSHIP_TYPES.AccountPurgeHandler,
    );

    await expect(purgeStore.purge(userIdOf(APPLICANT))).rejects.toThrow(
      /FOREIGN KEY constraint failed/u,
    );

    await expect(handler.handle(userPurgeEvent(APPLICANT))).resolves.toEqual({
      kind: 'done',
    });
    const sponsorshipsAfterFirst = await readSponsorshipIds();
    const stopsAfterFirst = await readDisplayStopIds();
    await expect(handler.handle(userPurgeEvent(APPLICANT))).resolves.toEqual({
      kind: 'done',
    });

    await expect(readSponsorshipIds()).resolves.toStrictEqual(
      sponsorshipsAfterFirst,
    );
    await expect(readDisplayStopIds()).resolves.toStrictEqual(stopsAfterFirst);
    await expect(readSponsorshipIds()).resolves.toStrictEqual(
      [1, 2].map(sponsorshipIdOf),
    );
    await expect(readDisplayStopIds()).resolves.toStrictEqual(
      [1, 2, 3].map(displayStopIdOf),
    );
    await purgeStore.purge(userIdOf(APPLICANT));
    await expect(rowExists(users, userIdOf(APPLICANT))).resolves.toBe(false);
    await expect(readPaymentRecordIds()).resolves.toStrictEqual(
      PAYMENT_RECORD_IDS,
    );
  });

  test('プロダクトを持つ利用者の物理削除で、プロダクトの物理削除が申込を消し、その後の呼び直しで利用者の表示停止の区間を消して利用者を消し、決済履歴と他の利用者の行を残す', async () => {
    await insertEvent(PURGE_EVENT, {
      userId: userIdOf(OWNER),
      type: 'purge_due',
    });
    const userEnvelope = lifecycleEnvelope(
      RUN_USER_LIFECYCLE_MESSAGE.type,
      eventIdOf(PURGE_EVENT),
    );

    const first = await dispatch(userEnvelope);

    expect(first).toMatchObject({ acked: true, retried: false, resent: true });
    expect(first.productEnvelopes).toHaveLength(1);
    for (const envelope of first.productEnvelopes) {
      await expect(dispatch(envelope)).resolves.toMatchObject({
        acked: true,
        retried: false,
      });
    }
    await expect(rowExists(products, productIdOf(OWNED))).resolves.toBe(false);

    const last = await dispatch(userEnvelope);

    expect(last).toStrictEqual({
      acked: true,
      retried: false,
      resent: false,
      productEnvelopes: [],
    });
    await expect(rowExists(users, userIdOf(OWNER))).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();
    await expect(readSponsorshipIds()).resolves.toStrictEqual(
      [2, 3].map(sponsorshipIdOf),
    );
    await expect(readDisplayStopIds()).resolves.toStrictEqual(
      [3, 4].map(displayStopIdOf),
    );
    await expect(readPaymentRecordIds()).resolves.toStrictEqual(
      PAYMENT_RECORD_IDS,
    );
    await expect(rowExists(users, userIdOf(OTHER_OWNER))).resolves.toBe(true);
    await expect(rowExists(products, productIdOf(OTHERS))).resolves.toBe(true);
  });
});
