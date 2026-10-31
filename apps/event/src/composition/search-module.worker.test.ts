import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { createDatabase } from '../../db/client.ts';
import { ftsRankedSources } from '../../db/search/fts-query.ts';
import {
  SEARCH_INDEX_REFRESH_MESSAGE,
  SEARCH_INDEX_REFRESH_RETRY,
} from '../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { decideOnFailure } from '../../lib/core/messaging/retry-policy.ts';
import { ANALYZE_ENTITIES_ENDPOINT } from '../../lib/core/search/natural-language-protocol.ts';
import {
  FIXTURE_SEARCH_TARGET_NAME,
  fixtureProducts,
  fixtureProductSearchDocuments,
  fixtureSearchIndex,
  setUpFixtureSearchTarget,
} from '../../lib/workers/search/testing/fixture-search-target.ts';
import worker from '../index.ts';

// 本番の検索対象の集約点にテスト専用の検索対象を入れずに、エントリが読み込む集約点だけをテスト専用の検索対象へ差し替える
vi.mock('../../lib/workers/search/targets/index.ts', async () => {
  const { fixtureSearchTarget } =
    await import('../../lib/workers/search/testing/fixture-search-target.ts');
  return { SEARCH_TARGETS: [fixtureSearchTarget] };
});

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

interface ExtractorRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

const MESSAGE_TIMESTAMP = new Date('2026-10-31T03:04:05.678Z');
const UPDATED_AT = new Date('2026-10-31T01:02:03.000Z');
const DESCRIPTION_MARKER = 'orbital';

let sequence = 0;

function nextUlid(): string {
  sequence += 1;
  return `01JBD8G7Q3Z6W0K8N5S2X4Y${String(sequence).padStart(3, '0')}`;
}

function refreshEnvelope(
  id: string,
  sourceId: string,
  target: string = FIXTURE_SEARCH_TARGET_NAME,
): QueueEnvelope {
  return {
    v: 1,
    type: SEARCH_INDEX_REFRESH_MESSAGE.type,
    id,
    sentAt: '2026-10-31T03:04:05.000Z',
    body: { target, sourceId },
  };
}

async function runQueue(
  batch: MessageBatch,
  ctx: ExecutionContext,
): Promise<void> {
  const { queue } = worker;
  if (queue === undefined) {
    throw new Error('イベントサーバーのエントリにqueueハンドラーが無い');
  }
  await queue(batch, env, ctx);
}

// retry()は遅延の指定を記録しないため、ack・retryの状態はgetQueueResultで、遅延秒数はretryの呼び出しの引数で確かめる
async function dispatchRefresh(
  sourceId: string,
  attempts: number,
  target?: string,
): Promise<MessageOutcome> {
  const id = nextUlid();
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    {
      id,
      timestamp: MESSAGE_TIMESTAMP,
      attempts,
      body: refreshEnvelope(id, sourceId, target),
    },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const retrySpy = vi.spyOn(message, 'retry');
  const ctx = createExecutionContext();
  await runQueue(batch, ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  const retried = retryMessages.some(({ msgId }) => msgId === id);
  const delaySeconds = retrySpy.mock.calls.at(-1)?.[0]?.delaySeconds;
  return {
    acked: explicitAcks.includes(id),
    retried,
    ...(retried && delaySeconds !== undefined ? { delaySeconds } : {}),
  };
}

function stubExtractor(response: () => Response): ExtractorRequest[] {
  const requests: ExtractorRequest[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}',
      ) as unknown,
    });
    return Promise.resolve(response());
  });
  return requests;
}

function silenceConsole(): readonly unknown[][] {
  const calls: unknown[][] = [];
  const record = (...args: unknown[]): void => {
    calls.push(args);
  };
  for (const method of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return calls;
}

const db = createDatabase(env.DB);

async function insertProduct(id: string): Promise<void> {
  await db.insert(fixtureProducts).values({
    id,
    name: 'Launch Stadium',
    tagline: 'ship it today',
    description: `An **${DESCRIPTION_MARKER}** launch pad`,
    visible: true,
    updatedAt: UPDATED_AT,
    deletedAt: null,
  });
}

async function findDocument(sourceId: string) {
  const [row] = await db
    .select()
    .from(fixtureProductSearchDocuments)
    .where(eq(fixtureProductSearchDocuments.sourceId, sourceId));
  return row;
}

async function searchSourceIds(matchExpression: string): Promise<string[]> {
  const rows = await db.all<{ source_id: string }>(
    ftsRankedSources(fixtureSearchIndex, matchExpression),
  );
  return rows.map((row) => row.source_id);
}

let consoleCalls: readonly unknown[][];

beforeAll(async () => {
  await setUpFixtureSearchTarget(env.DB);
});

beforeEach(async () => {
  consoleCalls = silenceConsole();
  await db.delete(fixtureProductSearchDocuments);
  await db.delete(fixtureProducts);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('イベントサーバーの索引の更新の結線', () => {
  test('Queueへ送った索引の更新が、外部APIのキーワードで索引文書と全文検索の索引を作る', async () => {
    const sourceId = 'product-extracted';
    await insertProduct(sourceId);
    const requests = stubExtractor(() =>
      Response.json({
        entities: [
          { name: 'Rocket', type: 'CONSUMER_GOOD' },
          { name: '2026', type: 'DATE' },
        ],
        languageCode: 'en',
        languageSupported: true,
      }),
    );

    const outcome = await dispatchRefresh(sourceId, 1);

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe(ANALYZE_ENTITIES_ENDPOINT);
    expect(request?.method).toBe('POST');
    expect(request?.headers['x-goog-api-key']).toBe(env.GOOGLE_NL_API_KEY);
    expect(JSON.stringify(request?.body)).toContain(DESCRIPTION_MARKER);
    expect(await findDocument(sourceId)).toMatchObject({
      sourceVersion: UPDATED_AT.getTime(),
      name: 'Launch Stadium',
      tagline: 'ship it today',
      keywords: 'Rocket',
      keywordStatus: 'extracted',
    });
    expect(await searchSourceIds('"rocket"*')).toEqual([sourceId]);
    expect(await searchSourceIds('"stadium"*')).toEqual([sourceId]);
    expect(await searchSourceIds(`"${DESCRIPTION_MARKER}"*`)).toEqual([]);
    const logged = JSON.stringify(consoleCalls);
    expect(logged).toContain('extracted');
    expect(logged).not.toContain(DESCRIPTION_MARKER);
    expect(logged).not.toContain(String(env.GOOGLE_NL_API_KEY));
  });

  test('外部APIの一時的な失敗は再試行の方針の間隔で再試行され、最後の試行で縮退索引になる', async () => {
    const sourceId = 'product-fallback';
    await insertProduct(sourceId);
    const requests = stubExtractor(() => new Response(null, { status: 503 }));
    const expected = decideOnFailure(SEARCH_INDEX_REFRESH_RETRY, 1);
    if (expected.kind !== 'retry') {
      throw new Error('1回目の失敗は再試行になるはず');
    }

    const first = await dispatchRefresh(sourceId, 1);
    const afterFirst = await findDocument(sourceId);
    const firstMatches = await searchSourceIds('"stadium"*');
    const last = await dispatchRefresh(
      sourceId,
      SEARCH_INDEX_REFRESH_RETRY.maxAttempts,
    );

    expect(first).toStrictEqual({
      acked: false,
      retried: true,
      delaySeconds: expected.delaySeconds,
    });
    expect(expected.delaySeconds).toBe(
      SEARCH_INDEX_REFRESH_RETRY.baseDelaySeconds,
    );
    expect(afterFirst).toMatchObject({
      name: 'Launch Stadium',
      keywords: '',
      keywordStatus: 'pending',
    });
    expect(firstMatches).toEqual([sourceId]);
    expect(last).toStrictEqual({ acked: true, retried: false });
    expect(requests).toHaveLength(2);
    expect(await findDocument(sourceId)).toMatchObject({
      keywordStatus: 'fallback',
      extractionInputHash: null,
    });
    expect(await searchSourceIds(`"${DESCRIPTION_MARKER}"*`)).toEqual([
      sourceId,
    ]);
  });

  test('非対応言語は再試行せず、抽出の入力を索引のキーワードにする', async () => {
    const sourceId = 'product-unsupported';
    await insertProduct(sourceId);
    const requests = stubExtractor(() =>
      Response.json(
        {
          error: {
            code: 400,
            status: 'INVALID_ARGUMENT',
            message: 'The language sw is not supported for entity analysis.',
          },
        },
        { status: 400 },
      ),
    );

    const outcome = await dispatchRefresh(sourceId, 1);

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    expect(requests).toHaveLength(1);
    expect(await findDocument(sourceId)).toMatchObject({
      keywordStatus: 'unsupported',
    });
    expect(await searchSourceIds(`"${DESCRIPTION_MARKER}"*`)).toEqual([
      sourceId,
    ]);
  });

  test('未登録の検索対象への索引の更新は、外部APIを呼ばず再試行もしない', async () => {
    const requests = stubExtractor(() => Response.json({}));

    const outcome = await dispatchRefresh('product-1', 1, 'unknown-target');

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    expect(requests).toHaveLength(0);
    expect(JSON.stringify(consoleCalls)).toContain('unregistered-target');
  });
});
