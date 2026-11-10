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

import { directoryEntries } from '../../db/schema/directory/directory-entries.ts';
import { productSearchDocuments } from '../../db/schema/directory/product-search-documents.ts';
import { products } from '../../db/schema/product/products.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/product.ts';
import {
  SEARCH_INDEX_REFRESH_MESSAGE,
  type SearchIndexRefreshBody,
} from '../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import {
  insertIndexDocuments,
  readDirectoryEntries,
  readIndexedProductIds,
} from '../../lib/workers/directory/testing/directory-entry-fixtures.ts';
import { clearDirectoryTables } from '../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  eventIdOf,
  insertEvent,
  readEvent,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertProductEvent,
  insertProducts,
  insertUsers,
  productEventIdOf,
  productIdOf,
  readProductEvent,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import worker from '../index.ts';

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

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const OWNER = 1;

const OTHER_OWNER = 2;

// 投稿者の記録を100件ずつの書き込みで3回に分けて処理する件数
const OWNED_PRODUCTS = Array.from({ length: 205 }, (_, index) => index + 1);

const OTHER_PRODUCT = 1001;

const EVENT = 10;

type RefreshEnvelope = QueueEnvelope & {
  readonly body: SearchIndexRefreshBody;
};

interface DispatchResult {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly refreshEnvelopes: readonly RefreshEnvelope[];
}

let envelopeCount = 0;

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function lifecycleEnvelope(type: string, eventId: string): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type,
    id: `01JD0DRCY${String(envelopeCount).padStart(17, '0')}`,
    sentAt: T0.toISOString(),
    body: { eventId },
  };
}

function isRefreshEnvelope(sent: unknown): sent is RefreshEnvelope {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === SEARCH_INDEX_REFRESH_MESSAGE.type
  );
}

// 本番と同じQueueのconsumerで処理し、処理の中で送られた索引の更新の要求を実際には送らずに受け取る
async function dispatch(envelope: QueueEnvelope): Promise<DispatchResult> {
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
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      refreshEnvelopes: sendSpy.mock.calls.flatMap(([sent]) =>
        isRefreshEnvelope(sent) ? [sent] : [],
      ),
    };
  } finally {
    sendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

async function insertEntries(
  productIndexes: readonly number[],
  ownerIndex: number,
): Promise<void> {
  const rows = productIndexes.map((index) => ({
    id: `01JD0DENT${String(index).padStart(17, '0')}`,
    productId: productIdOf(index),
    ownerUserId: userIdOf(ownerIndex),
    firstWonAt: T0,
    createdAt: T0,
    updatedAt: T0,
  }));
  // 1行が6個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
  for (let start = 0; start < rows.length; start += 15) {
    await db.insert(directoryEntries).values(rows.slice(start, start + 15));
  }
}

function readPendingDocuments() {
  return db
    .select({
      sourceId: productSearchDocuments.sourceId,
      keywordStatus: productSearchDocuments.keywordStatus,
    })
    .from(productSearchDocuments)
    .orderBy(asc(productSearchDocuments.sourceId));
}

async function productExists(index: number): Promise<boolean> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productIdOf(index)));
  return rows.length === 1;
}

// Drizzleは失敗した文を包んだ例外を投げるため、D1の制約の違反の文言は原因の連鎖から探す
function causeMessagesOf(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join('\n');
}

function refreshBodiesOf(
  productIndexes: readonly number[],
): SearchIndexRefreshBody[] {
  return productIndexes.map((index) => ({
    target: 'product',
    sourceId: productIdOf(index),
  }));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearDirectoryTables();
  await insertUsers([OWNER, OTHER_OWNER]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('プロダクトの物理削除による掲載の記録の削除(directory-discovery.entry-erasure)', () => {
  beforeEach(async () => {
    await insertProducts([1], OWNER, { deletedAt: T0 });
    await insertProducts([OTHER_PRODUCT], OTHER_OWNER);
    await insertEntries([1], OWNER);
    await insertEntries([OTHER_PRODUCT], OTHER_OWNER);
    await insertIndexDocuments([productIdOf(1), productIdOf(OTHER_PRODUCT)]);
  });

  test('掲載の記録が残る間は、プロダクトの行の物理削除が外部キーの違反で失敗する', async () => {
    const caught = await db
      .delete(products)
      .where(eq(products.id, productIdOf(1)))
      .then(() => undefined)
      .catch((thrown: unknown) => thrown);

    expect(causeMessagesOf(caught)).toContain('FOREIGN KEY constraint failed');
    await expect(productExists(1)).resolves.toBe(true);
  });

  test('物理削除の時期の到来の処理が、記録と索引文書を先に消してproduct-launchの最後の物理削除を外部キーで失敗させない', async () => {
    await insertProductEvent(EVENT, 1, {
      ownerUserId: userIdOf(OWNER),
      type: 'purge_due',
    });

    const result = await dispatch(
      lifecycleEnvelope(
        RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        productEventIdOf(EVENT),
      ),
    );

    expect(result).toMatchObject({ acked: true, retried: false });
    await expect(productExists(1)).resolves.toBe(false);
    await expect(readProductEvent(EVENT)).resolves.toBeUndefined();
    await expect(readDirectoryEntries()).resolves.toMatchObject([
      { productId: productIdOf(OTHER_PRODUCT) },
    ]);
    await expect(readIndexedProductIds()).resolves.toStrictEqual([
      productIdOf(OTHER_PRODUCT),
    ]);
  });
});

describe('プロダクトの復元による索引の作り直し(directory-discovery.product-index-restore)', () => {
  beforeEach(async () => {
    await insertProducts([1, 2], OWNER);
    await insertEntries([1], OWNER);
  });

  test('掲載の記録があるプロダクトの索引文書を更新待ちにし、索引の更新を要求して完了する', async () => {
    await insertProductEvent(EVENT, 1, {
      ownerUserId: userIdOf(OWNER),
      type: 'unhidden',
    });

    const result = await dispatch(
      lifecycleEnvelope(
        RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        productEventIdOf(EVENT),
      ),
    );

    expect(result).toMatchObject({ acked: true, retried: false });
    await expect(readProductEvent(EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(readPendingDocuments()).resolves.toStrictEqual([
      { sourceId: productIdOf(1), keywordStatus: 'pending' },
    ]);
    expect(result.refreshEnvelopes.map(({ body }) => body)).toStrictEqual(
      refreshBodiesOf([1]),
    );
  });

  test('掲載の記録が無いプロダクトは、索引文書を作らず索引の更新も要求せずに完了する', async () => {
    await insertProductEvent(EVENT, 2, {
      ownerUserId: userIdOf(OWNER),
      type: 'unhidden',
    });

    const result = await dispatch(
      lifecycleEnvelope(
        RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        productEventIdOf(EVENT),
      ),
    );

    expect(result).toMatchObject({ acked: true, retried: false });
    await expect(readProductEvent(EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(readPendingDocuments()).resolves.toStrictEqual([]);
    expect(result.refreshEnvelopes).toStrictEqual([]);
  });
});

describe('投稿者の停止の解除による索引の作り直し(directory-discovery.account-index-restore)', () => {
  test('1回の実行で投稿者の全ての記録の索引文書を更新待ちにし、全ての索引の更新を要求して完了する', async () => {
    await insertProducts(OWNED_PRODUCTS, OWNER);
    await insertProducts([OTHER_PRODUCT], OTHER_OWNER);
    await insertEntries(OWNED_PRODUCTS, OWNER);
    await insertEntries([OTHER_PRODUCT], OTHER_OWNER);
    await insertEvent(EVENT, { userId: userIdOf(OWNER), type: 'unsuspended' });

    const result = await dispatch(
      lifecycleEnvelope(RUN_USER_LIFECYCLE_MESSAGE.type, eventIdOf(EVENT)),
    );

    expect(result).toMatchObject({ acked: true, retried: false });
    await expect(readEvent(EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
    const owned = OWNED_PRODUCTS.map(productIdOf).toSorted();
    await expect(readIndexedProductIds()).resolves.toStrictEqual(owned);
    expect(
      result.refreshEnvelopes.map(({ body }) => body.sourceId).toSorted(),
    ).toStrictEqual(owned);
  });
});
