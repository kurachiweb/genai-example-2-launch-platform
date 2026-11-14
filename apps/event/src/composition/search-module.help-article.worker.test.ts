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
import { helpArticleSearchDocuments } from '../../db/schema/help/help-article-search-documents.ts';
import { HELP_ARTICLE_SEARCH_INDEX } from '../../db/schema/help/help-article-search-index.ts';
import { helpArticles } from '../../db/schema/help/help-articles.ts';
import { ftsRankedSources } from '../../db/search/fts-query.ts';
import { SEARCH_INDEX_REFRESH_MESSAGE } from '../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import {
  clearHelpTables,
  db,
  HELP_AUTHOR_ADMIN_ID,
  helpArticleIdOf,
  insertHelpArticle,
} from '../../lib/workers/help/testing/help-fixtures.ts';
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

const HANDLE = 'getting-started';
const TITLE = 'Stadium guide';
const SUBTITLE = 'first steps';
const BODY_MARKER = 'orbital';
const BODY = `## Sign in\n\nAn **${BODY_MARKER}** launch pad`;
const EXTRACTED_KEYWORD = 'Rocket';

const PUBLISHED = 1;
const DRAFT = 2;

let sequence = 0;

function nextMessageId(): string {
  sequence += 1;
  return `01JD0HMSG${String(sequence).padStart(17, '0')}`;
}

function refreshEnvelope(id: string, sourceId: string): QueueEnvelope {
  return {
    v: 1,
    type: SEARCH_INDEX_REFRESH_MESSAGE.type,
    id,
    sentAt: '2026-11-11T03:04:05.000Z',
    body: { target: 'help-article', sourceId },
  };
}

async function dispatchRefresh(
  sourceId: string,
  runtimeEnv: Env = env,
): Promise<boolean> {
  const id = nextMessageId();
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    {
      id,
      timestamp: new Date('2026-11-11T03:04:05.678Z'),
      attempts: 1,
      body: refreshEnvelope(id, sourceId),
    },
  ]);
  const ctx = createExecutionContext();
  const { queue } = worker;
  if (queue === undefined) {
    throw new Error('イベントサーバーのエントリにqueueハンドラーが無い');
  }
  await queue(batch, runtimeEnv, ctx);
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

async function readDocument(articleIndex: number) {
  const [row] = await db
    .select()
    .from(helpArticleSearchDocuments)
    .where(
      eq(helpArticleSearchDocuments.sourceId, helpArticleIdOf(articleIndex)),
    );
  return row;
}

async function search(input: string): Promise<string[]> {
  const expression = buildFtsMatchExpression(normalizeSearchTerms(input));
  if (expression === undefined) {
    throw new Error('検索語が空');
  }
  const rows = await db.all<{ source_id: string }>(
    ftsRankedSources(HELP_ARTICLE_SEARCH_INDEX, expression),
  );
  return rows.map((row) => row.source_id);
}

let consoleCalls: readonly unknown[][];

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  consoleCalls = silenceConsole();
  await clearHelpTables();
  for (const articleIndex of [PUBLISHED, DRAFT]) {
    await insertHelpArticle(articleIndex, {
      handle: `${HANDLE}-${String(articleIndex)}`,
      title: TITLE,
      subtitle: SUBTITLE,
      bodyMarkdown: BODY,
      status: articleIndex === DRAFT ? 'draft' : 'published',
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('ヘルプ記事の検索対象の索引の更新', () => {
  test('公開の記事の索引文書を作り、タイトルの前方一致と本文のキーワードで検索できる', async () => {
    const requests = stubExtractor();

    const acked = await dispatchRefresh(helpArticleIdOf(PUBLISHED));

    expect(acked).toBe(true);
    expect(requests).toHaveLength(1);
    expect(await readDocument(PUBLISHED)).toMatchObject({
      title: TITLE,
      subtitle: SUBTITLE,
      keywords: EXTRACTED_KEYWORD,
      keywordStatus: 'extracted',
    });
    expect(await search('stad')).toEqual([helpArticleIdOf(PUBLISHED)]);
    expect(await search('first')).toEqual([helpArticleIdOf(PUBLISHED)]);
    expect(await search('rock')).toEqual([helpArticleIdOf(PUBLISHED)]);
    expect(await search(BODY_MARKER)).toEqual([]);
  });

  test('キーワード抽出を無効にした環境では、外部APIを呼ばずに本文の正規化したテキストを索引に入れ、本文の語で検索できる', async () => {
    const requests = stubExtractor();

    const acked = await dispatchRefresh(helpArticleIdOf(PUBLISHED), {
      ...env,
      KEYWORD_EXTRACTOR: 'disabled',
    });

    expect(acked).toBe(true);
    expect(requests).toEqual([]);
    expect(await readDocument(PUBLISHED)).toMatchObject({
      keywordStatus: 'disabled',
    });
    expect(await search('orbi')).toEqual([helpArticleIdOf(PUBLISHED)]);
    expect(await search('stad orbi')).toEqual([helpArticleIdOf(PUBLISHED)]);
  });

  test('外部APIへは本文の正規化したテキストだけを送り、タイトル・サブタイトル・ハンドル・作成した管理者の識別子は送らない', async () => {
    const requests = stubExtractor();

    await dispatchRefresh(helpArticleIdOf(PUBLISHED));

    const sent = JSON.stringify(requests);
    expect(requests).toMatchObject([
      { document: { content: `Sign in An ${BODY_MARKER} launch pad` } },
    ]);
    for (const excluded of [
      TITLE,
      SUBTITLE,
      HANDLE,
      HELP_AUTHOR_ADMIN_ID,
      helpArticleIdOf(PUBLISHED),
    ]) {
      expect(sent).not.toContain(excluded);
    }
    const stored = JSON.stringify(await readDocument(PUBLISHED));
    expect(stored).not.toContain(BODY_MARKER);
    expect(stored).not.toContain(HELP_AUTHOR_ADMIN_ID);
    expect(JSON.stringify(consoleCalls)).not.toContain(BODY_MARKER);
  });

  test('下書きの記事は外部APIを呼ばずに索引文書を消し、検索に一致しない', async () => {
    const requests = stubExtractor();
    await dispatchRefresh(helpArticleIdOf(PUBLISHED));
    await db
      .update(helpArticles)
      .set({ status: 'draft', revision: 2 })
      .where(eq(helpArticles.id, helpArticleIdOf(PUBLISHED)));

    const ackedPublished = await dispatchRefresh(helpArticleIdOf(PUBLISHED));
    const ackedDraft = await dispatchRefresh(helpArticleIdOf(DRAFT));

    expect([ackedPublished, ackedDraft]).toEqual([true, true]);
    expect(requests).toHaveLength(1);
    expect(await readDocument(PUBLISHED)).toBeUndefined();
    expect(await readDocument(DRAFT)).toBeUndefined();
    expect(await search('stad')).toEqual([]);
  });
});
