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

import { productSearchDocuments } from '../../db/schema/directory/product-search-documents.ts';
import { products } from '../../db/schema/product/products.ts';
import {
  SEARCH_INDEX_REFRESH_MESSAGE,
  type SearchIndexRefreshBody,
} from '../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { readDirectoryEntries } from '../../lib/workers/directory/testing/directory-entry-fixtures.ts';
import { clearDirectoryTables } from '../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  DECIDED_AT,
  STARTS_AT,
} from '../../lib/workers/match/testing/directory-fixtures.ts';
import {
  insertMatchEvents,
  matchEventIdOf,
  readHandlerRuns,
  readMatchEvent,
} from '../../lib/workers/match/testing/event-fixtures.ts';
import { insertMatch } from '../../lib/workers/match/testing/match-fixtures.ts';
import { seedMatchPlatformSample } from '../../lib/workers/match/testing/match-platform-fixtures.ts';
import {
  db,
  productIdOf,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import worker from '../index.ts';
import { matchEventEnvelope } from './testing/match-event-queue.ts';

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

const SAMPLE_MATCH = 1;

const BOTH_LOST_MATCH = 2;

const EVENT = 10;

const EXTRACTED_KEYWORD = 'Rocket';

type RefreshEnvelope = QueueEnvelope & {
  readonly body: SearchIndexRefreshBody;
};

interface DispatchResult {
  readonly acked: boolean;
  readonly refreshEnvelopes: readonly RefreshEnvelope[];
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
    const { explicitAcks } = await getQueueResult(batch, ctx);
    // 封筒や本文の不正でデッドレターへ移ったメッセージもackされるため、処理まで届いたことを確かめる
    expect(deadLetterSpy).not.toHaveBeenCalled();
    return {
      acked: explicitAcks.includes(message.id),
      refreshEnvelopes: sendSpy.mock.calls.flatMap(([sent]) =>
        isRefreshEnvelope(sent) ? [sent] : [],
      ),
    };
  } finally {
    sendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

function stubExtractor(): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      entities: [{ name: EXTRACTED_KEYWORD, type: 'CONSUMER_GOOD' }],
      languageCode: 'en',
      languageSupported: true,
    }),
  );
}

function readDocuments() {
  return db
    .select({
      sourceId: productSearchDocuments.sourceId,
      name: productSearchDocuments.name,
      keywordStatus: productSearchDocuments.keywordStatus,
    })
    .from(productSearchDocuments)
    .orderBy(asc(productSearchDocuments.sourceId));
}

async function productNameOf(index: number): Promise<string> {
  const [row] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, productIdOf(index)));
  if (row === undefined) {
    throw new Error('プロダクトが無い');
  }
  return row.name;
}

async function insertDecidedEvent(match: number): Promise<void> {
  await insertMatchEvents([
    { index: EVENT, match, type: 'decided', occurredAt: DECIDED_AT },
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearDirectoryTables();
  await seedMatchPlatformSample();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('予選の勝利の確定による掲載の記録の処理(directory-discovery.qualifier-listing)', () => {
  test('予選の結果の記録の処理の後に、勝ったプロダクトを記録して索引文書を更新待ちにし、索引の更新を要求する', async () => {
    await insertDecidedEvent(SAMPLE_MATCH);

    const result = await dispatch(matchEventEnvelope(matchEventIdOf(EVENT)));

    expect(result.acked).toBe(true);
    await expect(readHandlerRuns()).resolves.toMatchObject([
      {
        eventId: matchEventIdOf(EVENT),
        handlerName: 'directory-discovery.qualifier-listing',
      },
      {
        eventId: matchEventIdOf(EVENT),
        handlerName: 'match-engine.qualifier-outcome',
      },
    ]);
    await expect(readMatchEvent(matchEventIdOf(EVENT))).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(readDirectoryEntries()).resolves.toStrictEqual([
      {
        productId: productIdOf(1),
        ownerUserId: userIdOf(1),
        firstWonAt: DECIDED_AT,
        createdAt: DECIDED_AT,
        updatedAt: DECIDED_AT,
      },
    ]);
    await expect(readDocuments()).resolves.toStrictEqual([
      { sourceId: productIdOf(1), name: '', keywordStatus: 'pending' },
    ]);
    expect(result.refreshEnvelopes.map(({ body }) => body)).toStrictEqual([
      { target: 'product', sourceId: productIdOf(1) },
    ]);
  });

  test('要求された索引の更新は、予選の結果が記録済みのため掲載中のプロダクトとして索引文書を作る', async () => {
    stubExtractor();
    await insertDecidedEvent(SAMPLE_MATCH);
    const { refreshEnvelopes } = await dispatch(
      matchEventEnvelope(matchEventIdOf(EVENT)),
    );
    const [refresh] = refreshEnvelopes;
    if (refresh === undefined) {
      throw new Error('索引の更新が要求されていない');
    }

    const result = await dispatch(refresh);

    expect(result.acked).toBe(true);
    await expect(readDocuments()).resolves.toStrictEqual([
      {
        sourceId: productIdOf(1),
        name: await productNameOf(1),
        keywordStatus: 'extracted',
      },
    ]);
  });

  test('両者敗北の予選では記録も索引文書も作らず、索引の更新を要求しない', async () => {
    await insertMatch({
      index: BOTH_LOST_MATCH,
      columns: {
        startedAt: STARTS_AT,
        decidedAt: DECIDED_AT,
        decision: 'no_votes',
      },
      entries: [
        {
          index: 21,
          launch: 2,
          product: 2,
          owner: 1,
          columns: { result: 'lost' },
        },
        {
          index: 22,
          launch: 4,
          product: 4,
          owner: 2,
          columns: { result: 'lost' },
        },
      ],
    });
    await insertDecidedEvent(BOTH_LOST_MATCH);

    const result = await dispatch(matchEventEnvelope(matchEventIdOf(EVENT)));

    expect(result.acked).toBe(true);
    await expect(readDirectoryEntries()).resolves.toStrictEqual([]);
    await expect(readDocuments()).resolves.toStrictEqual([]);
    expect(result.refreshEnvelopes).toStrictEqual([]);
  });

  test('同じイベントのメッセージが重ねて届いても、記録を増やさずに最初の勝利の日時を残してackする', async () => {
    await insertDecidedEvent(SAMPLE_MATCH);
    const envelope = matchEventEnvelope(matchEventIdOf(EVENT));
    await dispatch(envelope);

    const result = await dispatch(envelope);

    expect(result.acked).toBe(true);
    await expect(readDirectoryEntries()).resolves.toMatchObject([
      { productId: productIdOf(1), firstWonAt: DECIDED_AT },
    ]);
    await expect(readHandlerRuns()).resolves.toHaveLength(2);
  });
});
