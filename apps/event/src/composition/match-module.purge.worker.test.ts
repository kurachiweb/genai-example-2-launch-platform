import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc, eq, inArray } from 'drizzle-orm';
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

import { users } from '../../db/schema/identity/users.ts';
import { matchUpvotes } from '../../db/schema/match/match-upvotes.ts';
import { products } from '../../db/schema/product/products.ts';
import {
  createAsyncLifecycleRegistry,
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  type UserLifecycleAsyncHandler,
} from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/product.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import {
  createProductLifecycleRegistry,
  type ProductLifecycleAsyncHandler,
} from '../../lib/core/product/product-lifecycle.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  eventIdOf,
  insertEvent,
  readEvent,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  minutesAfterStart,
  seedDirectoryOwners,
  settledQualifier,
} from '../../lib/workers/match/testing/directory-fixtures.ts';
import {
  readEntryRows,
  readMatchRows,
} from '../../lib/workers/match/testing/event-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  insertUpvotes,
  matchIdOf,
  upvoteIdOf,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  insertProductEvent,
  insertUser,
  productEventIdOf,
  productIdOf,
  readProductEvent,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { EntryUnlinkHandler } from '../application/match/entry-unlink-handler.ts';
import { EVENT_MATCH_TYPES } from '../application/match/event-match-types.ts';
import type { MatchPurgeStore } from '../application/match/ports.ts';
import { UpvoteErasureHandler } from '../application/match/upvote-erasure-handler.ts';
import worker from '../index.ts';
import { D1MatchPurgeStore } from '../infrastructure/match/d1-match-purge-store.ts';
import { MODULES } from './modules.ts';
import { PRODUCT_LIFECYCLE_ASYNC_HANDLERS } from './product-lifecycle-async-handlers.ts';
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

const UPVOTE_ERASURE_NAME = 'match-engine.upvote-erasure';

const ENTRY_UNLINK_NAME = 'match-engine.entry-unlink';

const INVOCATION_KINDS = ['fetch', 'scheduled', 'queue'] as const;

const OWNER = 1;

const SUPPORTER = 3;

const OTHER_SUPPORTER = 4;

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

let envelopeCount = 0;

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function lifecycleEnvelope(type: string, eventId: string): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type,
    id: `01JD0MPRG${String(envelopeCount).padStart(17, '0')}`,
    sentAt: T0.toISOString(),
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
      .filter(([sent]) => isEnvelopeOf(envelope.type, sent))
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

async function upvoteIds(): Promise<readonly string[]> {
  const rows = await db
    .select({ id: matchUpvotes.id })
    .from(matchUpvotes)
    .orderBy(asc(matchUpvotes.id));
  return rows.map(({ id }) => id);
}

// 利用者1のプロダクト1と利用者2のプロダクト3の確定した予選(マッチ1)と、利用者1のプロダクト2と利用者2のプロダクト4の確定した予選(マッチ2)。
// 利用者3は両方のマッチにUpvoteし(マッチ2は論理削除済み)、利用者4はマッチ1にUpvoteした
async function seedSettledMatches(): Promise<void> {
  await insertUser(SUPPORTER);
  await insertUser(OTHER_SUPPORTER);
  const second = settledQualifier(2);
  await insertMatches([
    settledQualifier(1),
    {
      ...second,
      entries: [
        { ...second.entries[0], index: 21, launch: 2, product: 2, owner: 1 },
        { ...second.entries[1], index: 22, launch: 4, product: 4, owner: 2 },
      ],
    },
  ]);
  await insertUpvotes([
    {
      index: 1,
      match: 1,
      entry: 11,
      user: SUPPORTER,
      upvotedAt: minutesAfterStart(10),
    },
    {
      index: 2,
      match: 2,
      entry: 22,
      user: SUPPORTER,
      upvotedAt: minutesAfterStart(20),
      columns: { deletedAt: minutesAfterStart(30) },
    },
    {
      index: 3,
      match: 1,
      entry: 12,
      user: OTHER_SUPPORTER,
      upvotedAt: minutesAfterStart(40),
    },
  ]);
}

async function markDeleted(
  userIndexes: readonly number[],
  productIndexes: readonly number[],
): Promise<void> {
  if (userIndexes.length > 0) {
    await db
      .update(users)
      .set({ deletedAt: T0 })
      .where(inArray(users.id, userIndexes.map(userIdOf)));
  }
  if (productIndexes.length > 0) {
    await db
      .update(products)
      .set({ deletedAt: T0 })
      .where(inArray(products.id, productIndexes.map(productIdOf)));
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await seedDirectoryOwners();
  await seedSettledMatches();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('Upvoteの物理削除とマッチ記録の紐付けの解除の処理の登録', () => {
  test('利用者の物理削除の開始に帯の1100で登録し、登録の検証を通ってproduct-launchのプロダクトの物理削除の後に並ぶ', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(
        ({ name }) => name === UPVOTE_ERASURE_NAME,
      ),
    ).toStrictEqual([
      {
        name: UPVOTE_ERASURE_NAME,
        events: ['purge_due'],
        order: 1100,
        handler: EVENT_MATCH_TYPES.UpvoteErasureHandler,
      },
    ]);
    expect(
      createAsyncLifecycleRegistry(USER_LIFECYCLE_ASYNC_HANDLERS)
        .handlersFor('purge_due')
        .map(({ name }) => name),
    ).toStrictEqual([
      'inquiry-chat.member-inquiry-purge',
      'payments.customer-erasure',
      'ultras-subscription.subscription-erasure',
      'user-profile-social.profile-erasure',
      'user-profile-social.owned-file-erasure',
      'product-launch.product-erasure',
      UPVOTE_ERASURE_NAME,
    ]);
  });

  test('プロダクトの物理削除の時期の到来に帯の1100で登録し、登録の検証を通ってproduct-launchの画像の削除の後に並ぶ', () => {
    expect(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS.filter(
        ({ name }) => name === ENTRY_UNLINK_NAME,
      ),
    ).toStrictEqual([
      {
        name: ENTRY_UNLINK_NAME,
        events: ['purge_due'],
        order: 1100,
        handler: EVENT_MATCH_TYPES.EntryUnlinkHandler,
      },
    ]);
    expect(
      createProductLifecycleRegistry(PRODUCT_LIFECYCLE_ASYNC_HANDLERS)
        .handlersFor('purge_due')
        .map(({ name }) => name),
    ).toStrictEqual(['product-launch.image-erasure', ENTRY_UNLINK_NAME]);
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、ストアと2つの処理を実装のクラスに解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(
        container.get<MatchPurgeStore>(EVENT_MATCH_TYPES.MatchPurgeStore),
      ).toBeInstanceOf(D1MatchPurgeStore);
      expect(
        container.get<UserLifecycleAsyncHandler>(
          EVENT_MATCH_TYPES.UpvoteErasureHandler,
        ),
      ).toBeInstanceOf(UpvoteErasureHandler);
      expect(
        container.get<ProductLifecycleAsyncHandler>(
          EVENT_MATCH_TYPES.EntryUnlinkHandler,
        ),
      ).toBeInstanceOf(EntryUnlinkHandler);
    },
  );
});

describe('プロダクトの物理削除によるマッチ記録の紐付けの解除(match-engine.entry-unlink)', () => {
  test('プロダクトの物理削除の時期の到来の処理が外部キーで失敗せずにプロダクトを消し、マッチと確定値・結果と相手の側とUpvoteを残す', async () => {
    await markDeleted([], [1]);
    await insertProductEvent(PURGE_EVENT, 1, {
      ownerUserId: userIdOf(OWNER),
      type: 'purge_due',
    });
    const matchesBefore = await readMatchRows();
    const [entry11, entry12, ...othersBefore] = await readEntryRows();

    const outcome = await dispatch(
      lifecycleEnvelope(
        RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        productEventIdOf(PURGE_EVENT),
      ),
    );

    expect(outcome).toMatchObject({ acked: true, retried: false });
    await expect(rowExists(products, productIdOf(1))).resolves.toBe(false);
    await expect(readProductEvent(PURGE_EVENT)).resolves.toBeUndefined();
    await expect(readMatchRows()).resolves.toStrictEqual(matchesBefore);
    const [unlinked, opponent, ...others] = await readEntryRows();
    expect(unlinked).toMatchObject({
      id: entryIdOf(11),
      matchId: matchIdOf(1),
      productId: null,
      launchId: null,
      ownerUserId: null,
      upvoteCount: entry11?.upvoteCount,
      lastUpvotedAt: entry11?.lastUpvotedAt,
      lastUpvoteSeq: entry11?.lastUpvoteSeq,
      result: 'won',
    });
    expect(unlinked?.unlinkedAt).toBeInstanceOf(Date);
    expect(opponent).toStrictEqual(entry12);
    expect(others).toStrictEqual(othersBefore);
    await expect(upvoteIds()).resolves.toStrictEqual([
      upvoteIdOf(1),
      upvoteIdOf(2),
      upvoteIdOf(3),
    ]);
  });
});

describe('利用者の物理削除によるUpvoteの物理削除(match-engine.upvote-erasure)', () => {
  test('Upvoteした利用者の物理削除の開始の処理がUpvoteの行で失敗せずに利用者を消し、他の利用者のUpvoteと側の確定値を残す', async () => {
    await markDeleted([SUPPORTER], []);
    await insertEvent(PURGE_EVENT, {
      userId: userIdOf(SUPPORTER),
      type: 'purge_due',
    });
    const entriesBefore = await readEntryRows();

    const outcome = await dispatch(
      lifecycleEnvelope(
        RUN_USER_LIFECYCLE_MESSAGE.type,
        eventIdOf(PURGE_EVENT),
      ),
    );

    expect(outcome).toStrictEqual({
      acked: true,
      retried: false,
      productEnvelopes: [],
    });
    await expect(rowExists(users, userIdOf(SUPPORTER))).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();
    await expect(upvoteIds()).resolves.toStrictEqual([upvoteIdOf(3)]);
    await expect(readEntryRows()).resolves.toStrictEqual(entriesBefore);
  });

  test('プロダクトを持つ退会者の物理削除で、プロダクトの物理削除が側の紐付けを外し、その後の呼び直しで利用者を消してマッチと相手の側を残す', async () => {
    await markDeleted([OWNER], [1, 2]);
    await insertEvent(PURGE_EVENT, {
      userId: userIdOf(OWNER),
      type: 'purge_due',
    });
    const userEnvelope = lifecycleEnvelope(
      RUN_USER_LIFECYCLE_MESSAGE.type,
      eventIdOf(PURGE_EVENT),
    );
    const matchesBefore = await readMatchRows();
    const entriesBefore = await readEntryRows();

    const first = await dispatch(userEnvelope);

    expect(first).toMatchObject({
      acked: true,
      retried: false,
      resentDelaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    expect(first.productEnvelopes).toHaveLength(2);
    for (const envelope of first.productEnvelopes) {
      await expect(dispatch(envelope)).resolves.toMatchObject({
        acked: true,
        retried: false,
      });
    }
    await expect(rowExists(products, productIdOf(1))).resolves.toBe(false);
    await expect(rowExists(products, productIdOf(2))).resolves.toBe(false);

    const last = await dispatch(userEnvelope);

    expect(last).toStrictEqual({
      acked: true,
      retried: false,
      productEnvelopes: [],
    });
    await expect(rowExists(users, userIdOf(OWNER))).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();
    await expect(readMatchRows()).resolves.toStrictEqual(matchesBefore);
    const entries = await readEntryRows();
    expect(
      entries.map(({ id, productId, launchId, ownerUserId }) => ({
        id,
        linked: [productId, launchId, ownerUserId].some(
          (value) => value !== null,
        ),
      })),
    ).toStrictEqual([
      { id: entryIdOf(11), linked: false },
      { id: entryIdOf(12), linked: true },
      { id: entryIdOf(21), linked: false },
      { id: entryIdOf(22), linked: true },
    ]);
    expect(
      entries.map(({ upvoteCount, result }) => ({ upvoteCount, result })),
    ).toStrictEqual(
      entriesBefore.map(({ upvoteCount, result }) => ({
        upvoteCount,
        result,
      })),
    );
    expect([entries[1], entries[3]]).toStrictEqual([
      entriesBefore[1],
      entriesBefore[3],
    ]);
    await expect(upvoteIds()).resolves.toStrictEqual([
      upvoteIdOf(1),
      upvoteIdOf(2),
      upvoteIdOf(3),
    ]);
  });
});
