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

import {
  buildFtsMatchExpression,
  normalizeSearchTerms,
} from '../../common-lib/search/search-terms.ts';
import { productSearchDocuments } from '../../db/schema/directory/product-search-documents.ts';
import { PRODUCT_SEARCH_INDEX } from '../../db/schema/directory/product-search-index.ts';
import { products } from '../../db/schema/product/products.ts';
import { ftsRankedSources } from '../../db/search/fts-query.ts';
import { SEARCH_INDEX_REFRESH_MESSAGE } from '../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { emailOf } from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  after,
  clearProductTables,
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  productIdOf,
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

const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const OWNER_HANDLE = 'alice';
const NAME = 'Launch Stadium';
const TAGLINE = 'ship it today';
const WEBSITE_URL = 'https://launch-stadium.example/';
const DESCRIPTION_MARKER = 'orbital';
const DESCRIPTION = `An **${DESCRIPTION_MARKER}** launch pad`;
const EXTRACTED_KEYWORD = 'Rocket';

const LISTED = 1;
const HIDDEN = 2;

let sequence = 0;

function nextMessageId(): string {
  sequence += 1;
  return `01JD0MSG0${String(sequence).padStart(17, '0')}`;
}

function refreshEnvelope(id: string, sourceId: string): QueueEnvelope {
  return {
    v: 1,
    type: SEARCH_INDEX_REFRESH_MESSAGE.type,
    id,
    sentAt: '2026-11-10T03:04:05.000Z',
    body: { target: 'product', sourceId },
  };
}

async function dispatchRefresh(sourceId: string): Promise<boolean> {
  const id = nextMessageId();
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    {
      id,
      timestamp: new Date('2026-11-10T03:04:05.678Z'),
      attempts: 1,
      body: refreshEnvelope(id, sourceId),
    },
  ]);
  const ctx = createExecutionContext();
  const { queue } = worker;
  if (queue === undefined) {
    throw new Error('イベントサーバーのエントリにqueueハンドラーが無い');
  }
  await queue(batch, env, ctx);
  const { explicitAcks } = await getQueueResult(batch, ctx);
  return explicitAcks.includes(id);
}

function stubExtractor(): unknown[] {
  const bodies: unknown[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
    bodies.push(
      JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as unknown,
    );
    return Promise.resolve(
      Response.json({
        entities: [{ name: EXTRACTED_KEYWORD, type: 'CONSUMER_GOOD' }],
        languageCode: 'en',
        languageSupported: true,
      }),
    );
  });
  return bodies;
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

async function readDocument(productIndex: number) {
  const [row] = await db
    .select()
    .from(productSearchDocuments)
    .where(eq(productSearchDocuments.sourceId, productIdOf(productIndex)));
  return row;
}

async function search(input: string): Promise<string[]> {
  const expression = buildFtsMatchExpression(normalizeSearchTerms(input));
  if (expression === undefined) {
    throw new Error('検索語が空');
  }
  const rows = await db.all<{ source_id: string }>(
    ftsRankedSources(PRODUCT_SEARCH_INDEX, expression),
  );
  return rows.map((row) => row.source_id);
}

let consoleCalls: readonly unknown[][];

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  consoleCalls = silenceConsole();
  await db.delete(productSearchDocuments);
  await clearProductTables();
  await insertUser(1, { handle: OWNER_HANDLE });
  for (const productIndex of [LISTED, HIDDEN]) {
    await insertProduct(productIndex, 1, {
      handle: `stadium${String(productIndex)}`,
      name: NAME,
      tagline: TAGLINE,
      websiteUrl: WEBSITE_URL,
      descriptionMarkdown: DESCRIPTION,
      ...(productIndex === HIDDEN ? { hiddenAt: after(1) } : {}),
    });
    await insertLaunch(productIndex, productIndex, {
      outcome: 'won',
      decidedAt: after(10),
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('プロダクトの検索対象の索引の更新', () => {
  test('掲載中のプロダクトの索引文書を作り、名称の前方一致と説明文のキーワードで検索できる', async () => {
    const requests = stubExtractor();

    const acked = await dispatchRefresh(productIdOf(LISTED));

    expect(acked).toBe(true);
    expect(requests).toHaveLength(1);
    expect(await readDocument(LISTED)).toMatchObject({
      name: NAME,
      tagline: TAGLINE,
      keywords: EXTRACTED_KEYWORD,
      keywordStatus: 'extracted',
    });
    expect(await search('stad')).toEqual([productIdOf(LISTED)]);
    expect(await search('rock')).toEqual([productIdOf(LISTED)]);
    expect(await search(DESCRIPTION_MARKER)).toEqual([]);
  });

  test('索引文書には名称・タグライン・キーワードだけを入れ、外部APIへはタグラインと説明文のテキストだけを送り、名称・ハンドル・メールアドレス・URLは送らない', async () => {
    const requests = stubExtractor();

    await dispatchRefresh(productIdOf(LISTED));

    const document = await readDocument(LISTED);
    expect(Object.keys(document ?? {}).toSorted()).toEqual(
      [
        'id',
        'sourceId',
        'sourceVersion',
        'keywords',
        'keywordStatus',
        'extractionInputHash',
        'statusChangedAt',
        'name',
        'tagline',
      ].toSorted(),
    );
    const stored = JSON.stringify(document);
    const sent = JSON.stringify(requests);
    expect(requests).toMatchObject([
      {
        document: {
          content: `${TAGLINE}\n\nAn ${DESCRIPTION_MARKER} launch pad`,
        },
      },
    ]);
    expect(sent).not.toContain(NAME);
    expect(stored).not.toContain(DESCRIPTION_MARKER);
    for (const excluded of [OWNER_HANDLE, emailOf(1), WEBSITE_URL]) {
      expect(stored).not.toContain(excluded);
      expect(sent).not.toContain(excluded);
    }
    expect(JSON.stringify(consoleCalls)).not.toContain(DESCRIPTION_MARKER);
    expect(JSON.stringify(consoleCalls)).not.toContain(TAGLINE);
  });

  test('掲載中でないプロダクトは外部APIを呼ばずに索引文書を消す', async () => {
    const requests = stubExtractor();
    await dispatchRefresh(productIdOf(LISTED));
    await db
      .update(products)
      .set({ hiddenAt: after(20) })
      .where(eq(products.id, productIdOf(LISTED)));

    const ackedListed = await dispatchRefresh(productIdOf(LISTED));
    const ackedHidden = await dispatchRefresh(productIdOf(HIDDEN));

    expect([ackedListed, ackedHidden]).toEqual([true, true]);
    expect(requests).toHaveLength(1);
    expect(await readDocument(LISTED)).toBeUndefined();
    expect(await readDocument(HIDDEN)).toBeUndefined();
    expect(await search('stad')).toEqual([]);
  });
});
