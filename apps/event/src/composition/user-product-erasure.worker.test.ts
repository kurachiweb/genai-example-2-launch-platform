import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
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

import { products } from '../../db/schema/product/products.ts';
import { users } from '../../db/schema/identity/users.ts';
import {
  createAsyncLifecycleRegistry,
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  type UserLifecycleAsyncHandler,
} from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/product.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  eventIdOf,
  insertEvent,
  readEvent,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  clearProductTables,
  db,
  insertProduct,
  insertUser,
  productIdOf,
  readProductEventsOf,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { EVENT_PRODUCT_TYPES } from '../application/product/event-product-types.ts';
import { UserProductErasureHandler } from '../application/product/user-product-erasure-handler.ts';
import worker from '../index.ts';
import { MODULES } from './modules.ts';
import { USER_LIFECYCLE_ASYNC_HANDLERS } from './user-lifecycle-async-handlers.ts';

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
  readonly resentDelaySeconds?: number | undefined;
  readonly productEnvelopes: readonly QueueEnvelope[];
}

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const HANDLER_NAME = 'product-launch.product-erasure';

const INVOCATION_KINDS = ['fetch', 'scheduled', 'queue'] as const;

const OWNER = 1;

const OTHER_OWNER = 2;

const PURGE_EVENT = 10;

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: { kind, correlationId: crypto.randomUUID(), clientIp: undefined },
    },
    MODULES,
  );
}

function isEnvelopeOf(type: string, sent: unknown): sent is QueueEnvelope {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === type
  );
}

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形のIDを振る
const userEnvelope: QueueEnvelope = Object.freeze({
  v: 1,
  type: RUN_USER_LIFECYCLE_MESSAGE.type,
  id: '01JD0PRE000000000000000001',
  sentAt: T0.toISOString(),
  body: { eventId: eventIdOf(PURGE_EVENT) },
});

// 本番と同じエントリのqueueハンドラーで処理する。送り直しと送信は実際には送らず、送られた封筒を集めて後で同じハンドラーへ渡す
async function dispatch(envelope: QueueEnvelope): Promise<MessageOutcome> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: T0, attempts: 1, body: envelope },
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
    // 封筒や本文の不正でデッドレターへ移ったメッセージもackされるため、処理まで届いたことを確かめる
    expect(deadLetterSpy).not.toHaveBeenCalled();
    const resend = sendSpy.mock.calls
      .filter(([sent]) => isEnvelopeOf(RUN_USER_LIFECYCLE_MESSAGE.type, sent))
      .at(-1);
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      ...(resend === undefined
        ? {}
        : { resentDelaySeconds: resend[1]?.delaySeconds }),
      productEnvelopes: sendSpy.mock.calls.flatMap(([sent]) =>
        isEnvelopeOf(RUN_PRODUCT_LIFECYCLE_MESSAGE.type, sent) ? [sent] : [],
      ),
    };
  } finally {
    sendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

async function productRowExists(productIndex: number): Promise<boolean> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productIdOf(productIndex)));
  return rows.length === 1;
}

async function userRowExists(userIndex: number): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userIdOf(userIndex)));
  return rows.length === 1;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearProductTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('利用者のプロダクトの物理削除の波及処理の登録', () => {
  test('物理削除の開始に順序1000で登録し、登録の検証を通ってuser-profile-socialの後に並ぶ', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('product-launch.'),
      ),
    ).toStrictEqual([
      {
        name: HANDLER_NAME,
        events: ['purge_due'],
        order: 1000,
        handler: EVENT_PRODUCT_TYPES.UserProductErasureHandler,
      },
    ]);
    const registry = createAsyncLifecycleRegistry(
      USER_LIFECYCLE_ASYNC_HANDLERS,
    );
    expect(
      registry.handlersFor('purge_due').map(({ name }) => name),
    ).toStrictEqual([
      'inquiry-chat.member-inquiry-purge',
      'payments.customer-erasure',
      'ultras-subscription.subscription-erasure',
      'user-profile-social.profile-erasure',
      'user-profile-social.owned-file-erasure',
      HANDLER_NAME,
      'match-engine.upvote-erasure',
    ]);
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、波及処理を実装のクラスに解決する',
    (kind) => {
      expect(
        createContainer(kind).get<UserLifecycleAsyncHandler>(
          EVENT_PRODUCT_TYPES.UserProductErasureHandler,
        ),
      ).toBeInstanceOf(UserProductErasureHandler);
    },
  );
});

describe('退会者のプロダクトの物理削除', () => {
  test('2つのプロダクトを持つ退会者の物理削除の開始で2つのプロダクトの物理削除を開始して待ち、実行器がプロダクトを物理削除した後の呼び直しで利用者を物理削除する', async () => {
    await insertUser(OWNER, { deletedAt: T0 });
    await insertUser(OTHER_OWNER);
    await insertProduct(1, OWNER, { deletedAt: T0 });
    await insertProduct(2, OWNER, { deletedAt: T0 });
    await insertProduct(3, OTHER_OWNER);
    await insertEvent(PURGE_EVENT, {
      userId: userIdOf(OWNER),
      type: 'purge_due',
    });

    const first = await dispatch(userEnvelope);

    expect(first).toMatchObject({
      acked: true,
      retried: false,
      resentDelaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    const purgeDueOf = async (productIndex: number) =>
      (await readProductEventsOf(productIndex)).map(({ type }) => type);
    await expect(purgeDueOf(1)).resolves.toStrictEqual(['purge_due']);
    await expect(purgeDueOf(2)).resolves.toStrictEqual(['purge_due']);
    await expect(purgeDueOf(3)).resolves.toStrictEqual([]);
    expect(first.productEnvelopes).toHaveLength(2);
    await expect(readEvent(PURGE_EVENT)).resolves.toMatchObject({
      status: 'pending',
    });

    const waiting = await dispatch(userEnvelope);

    expect(waiting).toMatchObject({
      acked: true,
      resentDelaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
      productEnvelopes: [],
    });
    await expect(userRowExists(OWNER)).resolves.toBe(true);

    for (const envelope of first.productEnvelopes) {
      await expect(dispatch(envelope)).resolves.toMatchObject({
        acked: true,
        retried: false,
      });
    }
    await expect(productRowExists(1)).resolves.toBe(false);
    await expect(productRowExists(2)).resolves.toBe(false);

    const last = await dispatch(userEnvelope);

    expect(last).toStrictEqual({
      acked: true,
      retried: false,
      productEnvelopes: [],
    });
    await expect(userRowExists(OWNER)).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();
    await expect(productRowExists(3)).resolves.toBe(true);
  });
});
