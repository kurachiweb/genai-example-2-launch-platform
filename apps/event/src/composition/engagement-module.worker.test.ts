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

import { launchComments } from '../../db/schema/engagement/launch-comments.ts';
import { productRatings } from '../../db/schema/engagement/product-ratings.ts';
import { users } from '../../db/schema/identity/users.ts';
import { products } from '../../db/schema/product/products.ts';
import {
  createAsyncLifecycleRegistry,
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  type UserLifecycleAsyncHandler,
  type UserLifecycleEvent,
} from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/product.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import {
  createProductLifecycleRegistry,
  type ProductLifecycleAsyncHandler,
  type ProductLifecycleEvent,
} from '../../lib/core/product/product-lifecycle.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearEngagementTables,
  commentIdOf,
  type CommentFixture,
  db,
  insertComments,
  insertLaunch,
  insertProduct,
  insertRatings,
  insertUser,
  productIdOf,
  ratingIdOf,
  T0,
  userIdOf,
} from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
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
import { AccountErasureHandler } from '../application/engagement/account-erasure-handler.ts';
import { EVENT_ENGAGEMENT_TYPES } from '../application/engagement/event-engagement-types.ts';
import { ProductErasureHandler } from '../application/engagement/product-erasure-handler.ts';
import { EVENT_IDENTITY_TYPES } from '../application/identity/event-identity-types.ts';
import type { IdentityPurgeStore } from '../application/identity/ports.ts';
import { EVENT_PRODUCT_TYPES } from '../application/product/event-product-types.ts';
import type { ProductPurgeStore } from '../application/product/ports.ts';
import worker from '../index.ts';
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

const ACCOUNT_ERASURE_NAME = 'engagement.account-erasure';

const PRODUCT_ERASURE_NAME = 'engagement.product-erasure';

const INVOCATION_KINDS = ['fetch', 'scheduled', 'queue'] as const;

const OWNER = 1;

const OTHER_OWNER = 2;

const COMMENTER = 3;

const OTHER_COMMENTER = 4;

// 利用者1のプロダクト1・ローンチ1と、利用者2のプロダクト2・ローンチ2
const OWNED = 1;

const OTHERS = 2;

const PURGE_EVENT = 10;

// 1回の処理の上限(500件)を1件だけ超えるコメントの数
const COMMENTS_OVER_BATCH = 501;

const BULK_COMMENT_START = 1000;

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
    id: `01JD0ENGM${String(envelopeCount).padStart(17, '0')}`,
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

function userPurgeEvent(user: number): UserLifecycleEvent {
  return {
    id: eventIdOf(PURGE_EVENT),
    userId: userIdOf(user),
    type: 'purge_due',
    occurredAt: T0,
  };
}

function productPurgeEvent(product: number): ProductLifecycleEvent {
  return {
    id: productEventIdOf(PURGE_EVENT),
    productId: productIdOf(product),
    ownerUserId: userIdOf(OWNER),
    type: 'purge_due',
    occurredAt: T0,
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

async function readCommentRows() {
  return db
    .select({
      id: launchComments.id,
      productId: launchComments.productId,
      authorUserId: launchComments.authorUserId,
      body: launchComments.body,
      anonymizedAt: launchComments.anonymizedAt,
      deletedAt: launchComments.deletedAt,
    })
    .from(launchComments)
    .orderBy(asc(launchComments.id));
}

async function ratingIds(): Promise<readonly string[]> {
  const rows = await db
    .select({ id: productRatings.id })
    .from(productRatings)
    .orderBy(asc(productRatings.id));
  return rows.map(({ id }) => id);
}

async function commentCountOfProduct(product: number): Promise<number> {
  return db.$count(
    launchComments,
    eq(launchComments.productId, productIdOf(product)),
  );
}

async function commentCountOfAuthor(user: number): Promise<number> {
  return db.$count(
    launchComments,
    eq(launchComments.authorUserId, userIdOf(user)),
  );
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

// コメント1〜3は利用者1のプロダクト1への3階層のスレッド(1は利用者3、2は利用者4の返信、3は利用者3の返信)、コメント4は利用者4のプロダクト1へのトップレベル、
// コメント5は利用者3が削除したプロダクト2へのコメント、コメント6は利用者1のプロダクト2へのコメント、コメント7は利用者4のプロダクト2へのコメントである
const THREAD_COMMENTS: readonly CommentFixture[] = [
  { index: 1, product: OWNED, launch: OWNED, author: COMMENTER },
  {
    index: 2,
    product: OWNED,
    launch: OWNED,
    author: OTHER_COMMENTER,
    parent: { index: 1, root: 1 },
    depth: 2,
  },
  {
    index: 3,
    product: OWNED,
    launch: OWNED,
    author: COMMENTER,
    parent: { index: 2, root: 1 },
    depth: 3,
  },
  { index: 4, product: OWNED, launch: OWNED, author: OTHER_COMMENTER },
  {
    index: 5,
    product: OTHERS,
    launch: OTHERS,
    author: COMMENTER,
    columns: { deletedAt: T0 },
  },
  { index: 6, product: OTHERS, launch: OTHERS, author: OWNER },
  { index: 7, product: OTHERS, launch: OTHERS, author: OTHER_COMMENTER },
];

async function seedEngagement(): Promise<void> {
  await clearEngagementTables();
  for (const user of [OWNER, OTHER_OWNER, COMMENTER, OTHER_COMMENTER]) {
    await insertUser(user);
  }
  await insertProduct(OWNED, OWNER);
  await insertProduct(OTHERS, OTHER_OWNER);
  await insertLaunch(OWNED, OWNED);
  await insertLaunch(OTHERS, OTHERS);
  await insertComments(THREAD_COMMENTS);
  await insertRatings([
    { index: 1, product: OWNED, user: COMMENTER, score: 4 },
    { index: 2, product: OWNED, user: OTHER_COMMENTER, score: 2 },
    { index: 3, product: OTHERS, user: COMMENTER, score: 5 },
    { index: 4, product: OTHERS, user: OWNER, score: 3 },
  ]);
}

async function insertBulkComments(
  product: number,
  author: number,
): Promise<void> {
  await insertComments(
    Array.from({ length: COMMENTS_OVER_BATCH }, (_, offset) => ({
      index: BULK_COMMENT_START + offset,
      product,
      launch: product,
      author,
    })),
  );
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await seedEngagement();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('コメントと評価の物理削除の時期の処理の登録', () => {
  test('利用者の物理削除の開始に帯の1400で登録し、登録の検証を通ってnotificationsの物理削除の後に並ぶ', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('engagement.'),
      ),
    ).toStrictEqual([
      {
        name: ACCOUNT_ERASURE_NAME,
        events: ['purge_due'],
        order: 1400,
        handler: EVENT_ENGAGEMENT_TYPES.AccountErasureHandler,
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
      'match-engine.upvote-erasure',
      'notifications.account-purge',
      ACCOUNT_ERASURE_NAME,
      'sponsorship.account-purge',
      'ugc-moderation.account-record-erasure',
    ]);
  });

  test('プロダクトの物理削除の時期の到来に帯の1400で登録し、登録の検証を通ってdirectory-discoveryの記録の削除の後に並ぶ', () => {
    expect(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('engagement.'),
      ),
    ).toStrictEqual([
      {
        name: PRODUCT_ERASURE_NAME,
        events: ['purge_due'],
        order: 1400,
        handler: EVENT_ENGAGEMENT_TYPES.ProductErasureHandler,
      },
    ]);
    expect(
      createProductLifecycleRegistry(PRODUCT_LIFECYCLE_ASYNC_HANDLERS)
        .handlersFor('purge_due')
        .map(({ name }) => name),
    ).toStrictEqual([
      'product-launch.image-erasure',
      'match-engine.entry-unlink',
      'directory-discovery.entry-erasure',
      PRODUCT_ERASURE_NAME,
      'tournament-week.entry-unlink',
      'sponsorship.product-purge',
      'tournament-year.entry-unlink',
      'ugc-moderation.product-record-erasure',
    ]);
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、2つの処理を実装のクラスに解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(
        container.get<UserLifecycleAsyncHandler>(
          EVENT_ENGAGEMENT_TYPES.AccountErasureHandler,
        ),
      ).toBeInstanceOf(AccountErasureHandler);
      expect(
        container.get<ProductLifecycleAsyncHandler>(
          EVENT_ENGAGEMENT_TYPES.ProductErasureHandler,
        ),
      ).toBeInstanceOf(ProductErasureHandler);
    },
  );
});

describe('利用者の物理削除によるコメントの匿名化と評価の削除(engagement.account-erasure)', () => {
  test('コメントと評価が残る間はidentity-authの物理削除が外部キーで失敗し、処理の後に成功する。同じイベントで2回動いても結果が同じ', async () => {
    const container = createContainer('queue');
    const purgeStore = container.get<IdentityPurgeStore>(
      EVENT_IDENTITY_TYPES.IdentityPurgeStore,
    );
    const handler = container.get<UserLifecycleAsyncHandler>(
      EVENT_ENGAGEMENT_TYPES.AccountErasureHandler,
    );

    await expect(purgeStore.purge(userIdOf(COMMENTER))).rejects.toThrow(
      /FOREIGN KEY constraint failed/u,
    );

    await expect(handler.handle(userPurgeEvent(COMMENTER))).resolves.toEqual({
      kind: 'done',
    });
    const afterFirst = await readCommentRows();
    const ratingsAfterFirst = await ratingIds();
    await expect(handler.handle(userPurgeEvent(COMMENTER))).resolves.toEqual({
      kind: 'done',
    });

    await expect(readCommentRows()).resolves.toStrictEqual(afterFirst);
    await expect(ratingIds()).resolves.toStrictEqual(ratingsAfterFirst);
    await purgeStore.purge(userIdOf(COMMENTER));
    await expect(rowExists(users, userIdOf(COMMENTER))).resolves.toBe(false);
  });

  test('利用者の物理削除の開始の処理が、コメントを匿名化して返信のつながりを保ち、評価を消して利用者を消し、他の利用者の行を残す', async () => {
    await markDeleted([COMMENTER], []);
    await insertEvent(PURGE_EVENT, {
      userId: userIdOf(COMMENTER),
      type: 'purge_due',
    });
    const before = await readCommentRows();

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
    await expect(rowExists(users, userIdOf(COMMENTER))).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();
    const comments = await readCommentRows();
    expect(comments.map(({ id }) => id)).toStrictEqual(
      THREAD_COMMENTS.map(({ index }) => commentIdOf(index)),
    );
    const anonymizedIds = [1, 3, 5].map(commentIdOf);
    for (const comment of comments) {
      if (anonymizedIds.includes(comment.id)) {
        expect(comment).toMatchObject({ authorUserId: null, body: '' });
        expect(comment.anonymizedAt).toBeInstanceOf(Date);
      } else {
        expect(comment).toStrictEqual(
          before.find(({ id }) => id === comment.id),
        );
      }
    }
    expect(comments.find(({ id }) => id === commentIdOf(5))?.deletedAt).toEqual(
      T0,
    );
    await expect(ratingIds()).resolves.toStrictEqual([
      ratingIdOf(2),
      ratingIdOf(4),
    ]);
    for (const user of [OWNER, OTHER_OWNER, OTHER_COMMENTER]) {
      await expect(rowExists(users, userIdOf(user))).resolves.toBe(true);
    }
  });

  test('1回の上限を超えるコメントを持つ利用者は、500件を匿名化して続きの送り直しを返し、再開の処理で残りを匿名化して利用者を消す', async () => {
    await insertBulkComments(OTHERS, COMMENTER);
    await markDeleted([COMMENTER], []);
    await insertEvent(PURGE_EVENT, {
      userId: userIdOf(COMMENTER),
      type: 'purge_due',
    });
    const userEnvelope = lifecycleEnvelope(
      RUN_USER_LIFECYCLE_MESSAGE.type,
      eventIdOf(PURGE_EVENT),
    );

    const first = await dispatch(userEnvelope);

    expect(first).toStrictEqual({
      acked: true,
      retried: false,
      resentDelaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
      productEnvelopes: [],
    });
    await expect(commentCountOfAuthor(COMMENTER)).resolves.toBe(
      COMMENTS_OVER_BATCH + 3 - 500,
    );
    await expect(rowExists(users, userIdOf(COMMENTER))).resolves.toBe(true);

    const last = await dispatch(userEnvelope);

    expect(last).toStrictEqual({
      acked: true,
      retried: false,
      productEnvelopes: [],
    });
    await expect(commentCountOfAuthor(COMMENTER)).resolves.toBe(0);
    await expect(rowExists(users, userIdOf(COMMENTER))).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();
  });

  test('プロダクトを持つ利用者の物理削除で、プロダクトの物理削除が他の利用者のものを含むコメントと評価を消し、その後の呼び直しで他者のプロダクトへのコメントを匿名化して利用者を消す', async () => {
    await markDeleted([OWNER], [OWNED]);
    await insertEvent(PURGE_EVENT, {
      userId: userIdOf(OWNER),
      type: 'purge_due',
    });
    const userEnvelope = lifecycleEnvelope(
      RUN_USER_LIFECYCLE_MESSAGE.type,
      eventIdOf(PURGE_EVENT),
    );

    const first = await dispatch(userEnvelope);

    expect(first).toMatchObject({
      acked: true,
      retried: false,
      resentDelaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    expect(first.productEnvelopes).toHaveLength(1);
    for (const envelope of first.productEnvelopes) {
      await expect(dispatch(envelope)).resolves.toMatchObject({
        acked: true,
        retried: false,
      });
    }
    await expect(rowExists(products, productIdOf(OWNED))).resolves.toBe(false);
    await expect(commentCountOfProduct(OWNED)).resolves.toBe(0);

    const last = await dispatch(userEnvelope);

    expect(last).toStrictEqual({
      acked: true,
      retried: false,
      productEnvelopes: [],
    });
    await expect(rowExists(users, userIdOf(OWNER))).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();
    const comments = await readCommentRows();
    expect(
      comments.map(({ id, authorUserId, body }) => ({
        id,
        authorUserId,
        body,
      })),
    ).toStrictEqual([
      {
        id: commentIdOf(5),
        authorUserId: userIdOf(COMMENTER),
        body: 'コメント5',
      },
      { id: commentIdOf(6), authorUserId: null, body: '' },
      {
        id: commentIdOf(7),
        authorUserId: userIdOf(OTHER_COMMENTER),
        body: 'コメント7',
      },
    ]);
    await expect(ratingIds()).resolves.toStrictEqual([ratingIdOf(3)]);
    await expect(rowExists(products, productIdOf(OTHERS))).resolves.toBe(true);
  });
});

describe('プロダクトの物理削除によるコメントと評価の削除(engagement.product-erasure)', () => {
  test('コメントと評価が残る間はproduct-launchの物理削除が外部キーで失敗し、処理の後に成功する。同じイベントで2回動いても結果が同じ', async () => {
    const container = createContainer('queue');
    const purgeStore = container.get<ProductPurgeStore>(
      EVENT_PRODUCT_TYPES.ProductPurgeStore,
    );
    const handler = container.get<ProductLifecycleAsyncHandler>(
      EVENT_ENGAGEMENT_TYPES.ProductErasureHandler,
    );

    await expect(purgeStore.purge(productIdOf(OWNED))).rejects.toThrow(
      /FOREIGN KEY constraint failed/u,
    );

    await expect(handler.handle(productPurgeEvent(OWNED))).resolves.toEqual({
      kind: 'done',
    });
    const afterFirst = await readCommentRows();
    const ratingsAfterFirst = await ratingIds();
    await expect(handler.handle(productPurgeEvent(OWNED))).resolves.toEqual({
      kind: 'done',
    });

    await expect(readCommentRows()).resolves.toStrictEqual(afterFirst);
    await expect(ratingIds()).resolves.toStrictEqual(ratingsAfterFirst);
    await purgeStore.purge(productIdOf(OWNED));
    await expect(rowExists(products, productIdOf(OWNED))).resolves.toBe(false);
  });

  test('プロダクトの物理削除の時期の到来の処理が、他の利用者のものを含む3階層のコメントと評価を消してプロダクトを消し、他のプロダクトの行を残す', async () => {
    await markDeleted([], [OWNED]);
    await insertProductEvent(PURGE_EVENT, OWNED, {
      ownerUserId: userIdOf(OWNER),
      type: 'purge_due',
    });
    const before = await readCommentRows();

    const outcome = await dispatch(
      lifecycleEnvelope(
        RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        productEventIdOf(PURGE_EVENT),
      ),
    );

    expect(outcome).toMatchObject({ acked: true, retried: false });
    await expect(rowExists(products, productIdOf(OWNED))).resolves.toBe(false);
    await expect(readProductEvent(PURGE_EVENT)).resolves.toBeUndefined();
    await expect(readCommentRows()).resolves.toStrictEqual(
      before.filter(({ productId }) => productId === productIdOf(OTHERS)),
    );
    await expect(ratingIds()).resolves.toStrictEqual([
      ratingIdOf(3),
      ratingIdOf(4),
    ]);
    await expect(rowExists(products, productIdOf(OTHERS))).resolves.toBe(true);
    await expect(rowExists(users, userIdOf(OWNER))).resolves.toBe(true);
  });

  test('1回の上限を超えるコメントを持つプロダクトは、500件を消して続きの送り直しを返し、再開の処理で残りを消してプロダクトを消す', async () => {
    await insertBulkComments(OWNED, OTHER_COMMENTER);
    await markDeleted([], [OWNED]);
    await insertProductEvent(PURGE_EVENT, OWNED, {
      ownerUserId: userIdOf(OWNER),
      type: 'purge_due',
    });
    const productEnvelope = lifecycleEnvelope(
      RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
      productEventIdOf(PURGE_EVENT),
    );

    const first = await dispatch(productEnvelope);

    expect(first).toMatchObject({
      acked: true,
      retried: false,
      resentDelaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    await expect(commentCountOfProduct(OWNED)).resolves.toBe(
      COMMENTS_OVER_BATCH + 4 - 500,
    );
    await expect(rowExists(products, productIdOf(OWNED))).resolves.toBe(true);

    const last = await dispatch(productEnvelope);

    expect(last).toMatchObject({ acked: true, retried: false });
    expect(last.resentDelaySeconds).toBeUndefined();
    await expect(commentCountOfProduct(OWNED)).resolves.toBe(0);
    await expect(rowExists(products, productIdOf(OWNED))).resolves.toBe(false);
    await expect(readProductEvent(PURGE_EVENT)).resolves.toBeUndefined();
    await expect(commentCountOfProduct(OTHERS)).resolves.toBe(3);
  });
});
