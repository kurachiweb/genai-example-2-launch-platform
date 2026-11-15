import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'vitest';

import { createDatabase, type Database } from '../../../db/client.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { SEARCH_INDEX_REFRESH_MESSAGE } from '../../core/messaging/contracts/search-index-refresh.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import { SEARCH_TYPES } from '../../core/search/identifiers.ts';
import type {
  SearchIndexRefreshRequester,
  SearchIndexStore,
  SearchSourceProvider,
  SearchTargetCatalog,
} from '../../core/search/ports.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { D1SearchIndexRepository } from './search-index-repository.ts';
import type { SearchIndexStatements } from './search-index-statements.ts';
import { createSearchPlatformModule } from './search-platform-module.ts';
import { RegistrySearchSourceProvider } from './search-source-provider.ts';
import { SearchTargetRegistryError } from './search-target-definition.ts';
import {
  FIXTURE_SEARCH_TARGET_NAME,
  fixtureProducts,
  fixtureProductSearchDocuments,
  fixtureSearchTarget,
  setUpFixtureSearchTarget,
} from './testing/fixture-search-target.ts';

interface RecordingQueue {
  readonly queue: Queue;
  readonly sent: unknown[];
}

const TARGET = FIXTURE_SEARCH_TARGET_NAME;
const SOURCE_ID = '01JBD8G7Q3Z6W0K8N5S2X4Y9TA';
const NOW = new Date('2026-10-31T03:04:05.678Z');

const db = createDatabase(env.DB);
const SEARCH_PLATFORM_MODULE = createSearchPlatformModule(
  [fixtureSearchTarget],
  'api',
);

function createRecordingQueue(): RecordingQueue {
  const sent: unknown[] = [];
  const queue: Queue = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

function createContainer(jobsQueue: Queue = env.JOBS_QUEUE): Container {
  return createInvocationContainer(
    {
      env: { ...env, JOBS_QUEUE: jobsQueue },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: 'correlation-search-platform',
        clientIp: undefined,
      },
    },
    [SEARCH_PLATFORM_MODULE],
  );
}

beforeAll(async () => {
  await setUpFixtureSearchTarget(env.DB);
});

beforeEach(async () => {
  await db.delete(fixtureProductSearchDocuments);
  await db.delete(fixtureProducts);
});

describe('createSearchPlatformModule', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      SEARCH_PLATFORM_MODULE,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(SEARCH_PLATFORM_MODULE.name).toBe('search-platform');
    expect('routes' in SEARCH_PLATFORM_MODULE).toBe(false);
  });

  test('登録の誤りがある検索対象の一覧では、モジュールを作る時に例外にする', () => {
    expect(() =>
      createSearchPlatformModule(
        [fixtureSearchTarget, fixtureSearchTarget],
        'api',
      ),
    ).toThrow(SearchTargetRegistryError);
  });

  test('検索対象の一覧を渡した検索対象から組み立てて束縛する', () => {
    const catalog = createContainer().get<SearchTargetCatalog>(
      SEARCH_TYPES.TargetCatalog,
    );

    expect(catalog.names()).toEqual([TARGET]);
    expect(catalog.find(TARGET)).toBe(fixtureSearchTarget);
  });

  test('索引の保存と元データの読み取りを解決でき、処理単位のD1で読み書きする', async () => {
    const container = createContainer();
    const store = container.get<SearchIndexStore>(SEARCH_TYPES.IndexStore);
    const sources = container.get<SearchSourceProvider>(
      SEARCH_TYPES.SourceProvider,
    );
    await db.insert(fixtureProducts).values({
      id: SOURCE_ID,
      name: 'Launch Stadium',
      tagline: 'ship it today',
      description: '',
      visible: true,
      updatedAt: NOW,
      deletedAt: null,
    });

    expect(store).toBeInstanceOf(D1SearchIndexRepository);
    expect(sources).toBeInstanceOf(RegistrySearchSourceProvider);
    await expect(sources.read(TARGET, SOURCE_ID)).resolves.toMatchObject({
      version: NOW.getTime(),
    });
    await expect(
      store.upsert(TARGET, SOURCE_ID, {
        sourceVersion: NOW.getTime(),
        texts: { name: 'Launch Stadium', tagline: 'ship it today' },
        keywords: { kind: 'set', value: 'rocket' },
        keywordStatus: 'extracted',
        extractionInputHash: 'hash-1',
        statusChangedAt: NOW,
      }),
    ).resolves.toBe('written');
  });

  test('ドメイン向けの文を解決でき、処理単位のデータベースの一括の書き込みに含められる', async () => {
    const container = createContainer();
    const statements = container.get<SearchIndexStatements>(
      SEARCH_TYPES.IndexStatements,
    );
    const database = container.get<Database>(PLATFORM_TYPES.Database);

    await database.batch([
      database.insert(fixtureProducts).values({
        id: SOURCE_ID,
        name: 'Launch Stadium',
        tagline: 'ship it today',
        description: '',
        visible: true,
        updatedAt: NOW,
        deletedAt: null,
      }),
      statements.markPending(TARGET, SOURCE_ID, NOW),
    ]);

    const [row] = await db
      .select()
      .from(fixtureProductSearchDocuments)
      .where(eq(fixtureProductSearchDocuments.sourceId, SOURCE_ID));
    expect(row).toMatchObject({ keywordStatus: 'pending', sourceVersion: 0 });
  });

  test('更新の要求を解決でき、処理単位のQueueへ索引の更新のメッセージを送る', async () => {
    const { queue, sent } = createRecordingQueue();
    const requester = createContainer(queue).get<SearchIndexRefreshRequester>(
      SEARCH_TYPES.RefreshRequester,
    );

    await requester.requestRefresh(TARGET, SOURCE_ID);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject<Partial<QueueEnvelope>>({
      type: SEARCH_INDEX_REFRESH_MESSAGE.type,
      body: { target: TARGET, sourceId: SOURCE_ID },
    });
  });

  test('処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const identifiers = [
      SEARCH_TYPES.IndexStore,
      SEARCH_TYPES.SourceProvider,
      SEARCH_TYPES.RefreshRequester,
      SEARCH_TYPES.IndexStatements,
    ];
    const first = createContainer();
    const second = createContainer();

    expect(first.get(SEARCH_TYPES.TargetCatalog)).toBe(
      second.get(SEARCH_TYPES.TargetCatalog),
    );
    for (const identifier of identifiers) {
      expect(first.get(identifier)).toBe(first.get(identifier));
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    }
  });

  test('アプリごとに束縛する抽出・更新の処理・再抽出のジョブは束縛しない', () => {
    const container = createContainer();

    expect(container.isBound(SEARCH_TYPES.KeywordExtractor)).toBe(false);
    expect(container.isBound(SEARCH_TYPES.RefreshHandler)).toBe(false);
    expect(container.isBound(SEARCH_TYPES.ReextractionJob)).toBe(false);
  });
});
