import { env } from 'cloudflare:workers';
import { eq, sql } from 'drizzle-orm';
import { Container } from 'inversify';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { createDatabase, type Database } from '../../../db/client.ts';
import { bm25Rank, ftsRankedSources } from '../../../db/search/fts-query.ts';
import type { SearchIndexDefinition } from '../../../db/search/search-index-definition.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import { SEARCH_TYPES } from '../../core/search/identifiers.ts';
import type { IndexWrite, SearchIndexStore } from '../../core/search/ports.ts';
import { D1SearchIndexRepository } from './search-index-repository.ts';
import {
  createSearchTargetRegistry,
  type SearchTargetRegistry,
  SearchTargetRegistryError,
} from './search-target-definition.ts';
import {
  defineFixtureSearchIndex,
  FIXTURE_SEARCH_TARGET_NAME,
  fixtureProducts,
  fixtureProductSearchDocuments,
  fixtureSearchIndex,
  fixtureSearchTarget,
  setUpFixtureSearchTarget,
} from './testing/fixture-search-target.ts';

const TARGET = FIXTURE_SEARCH_TARGET_NAME;
const SOURCE_ID = '01JBD8G7Q3Z6W0K8N5S2X4Y9TA';
const OTHER_SOURCE_ID = '01JBD8G7Q3Z6W0K8N5S2X4Y9TB';

const NOW = new Date('2026-10-31T03:04:05.678Z');
const LATER = new Date('2026-10-31T04:00:00.000Z');

const db = createDatabase(env.DB);
const registry = createSearchTargetRegistry([fixtureSearchTarget]);

const createRepository = (): SearchIndexStore =>
  new D1SearchIndexRepository(db, registry);

const writeOf = (overrides: Partial<IndexWrite> = {}): IndexWrite => ({
  sourceVersion: 100,
  texts: { name: 'Launch Stadium', tagline: 'ship it today' },
  keywords: { kind: 'set', value: 'rocket orbit' },
  keywordStatus: 'extracted',
  extractionInputHash: 'hash-1',
  statusChangedAt: NOW,
  ...overrides,
});

interface ProductInput {
  readonly id: string;
  readonly name?: string;
  readonly tagline?: string;
  readonly visible?: boolean;
  readonly deletedAt?: Date | null;
}

const insertProduct = async ({
  id,
  name = '',
  tagline = '',
  visible = true,
  deletedAt = null,
}: ProductInput): Promise<void> => {
  await db.insert(fixtureProducts).values({
    id,
    name,
    tagline,
    description: '',
    visible,
    updatedAt: NOW,
    deletedAt,
  });
};

const readDocuments = async () =>
  db
    .select()
    .from(fixtureProductSearchDocuments)
    .orderBy(fixtureProductSearchDocuments.sourceId);

const readDocument = async (sourceId: string) => {
  const [row] = await db
    .select()
    .from(fixtureProductSearchDocuments)
    .where(eq(fixtureProductSearchDocuments.sourceId, sourceId));
  return row;
};

// ドメインの検索のクエリと同じく、副問い合わせを元データと結合して可視性で絞り、関連度の昇順で並べる
const searchVisibleProducts = async (
  definition: SearchIndexDefinition,
  matchExpression: string,
): Promise<{ id: string; rank: number }[]> =>
  db.all<{ id: string; rank: number }>(
    sql`SELECT p.id AS id, r.rank AS rank FROM ${fixtureProducts} AS p JOIN (${ftsRankedSources(definition, matchExpression)}) AS r ON r.source_id = p.id WHERE p.visible = 1 AND p.deleted_at IS NULL ORDER BY r.rank, p.id`,
  );

const matchedIds = async (matchExpression: string): Promise<string[]> =>
  (await searchVisibleProducts(fixtureSearchIndex, matchExpression)).map(
    (row) => row.id,
  );

// external contentの索引が索引文書のテーブルと食い違うと、integrity-checkは例外になる
const checkFtsIntegrity = async (): Promise<void> => {
  const fts = sql.raw(fixtureSearchIndex.ftsTableName);
  await db.run(
    sql`INSERT INTO ${fts}(${fts}, rank) VALUES ('integrity-check', 1)`,
  );
};

beforeAll(async () => {
  await setUpFixtureSearchTarget(env.DB);
});

beforeEach(async () => {
  await db.delete(fixtureProductSearchDocuments);
  await db.delete(fixtureProducts);
});

describe('D1SearchIndexRepository', () => {
  test('データベースと検索対象の一覧を識別子で注入して解決できる', () => {
    const container = new Container();
    container.bind<Database>(PLATFORM_TYPES.Database).toConstantValue(db);
    container
      .bind<SearchTargetRegistry>(SEARCH_TYPES.TargetCatalog)
      .toConstantValue(registry);
    container.bind(D1SearchIndexRepository).toSelf();

    expect(container.get(D1SearchIndexRepository)).toBeInstanceOf(
      D1SearchIndexRepository,
    );
  });

  describe('upsert', () => {
    test('索引の対象の元データの索引文書を新しく作り、全ての列を書き込んで全文検索の索引にも加える', async () => {
      await insertProduct({ id: SOURCE_ID });

      const result = await createRepository().upsert(
        TARGET,
        SOURCE_ID,
        writeOf(),
      );

      expect(result).toBe('written');
      expect(await readDocuments()).toEqual([
        {
          id: expect.any(Number) as unknown,
          sourceId: SOURCE_ID,
          sourceVersion: 100,
          keywords: 'rocket orbit',
          keywordStatus: 'extracted',
          extractionInputHash: 'hash-1',
          statusChangedAt: NOW,
          name: 'Launch Stadium',
          tagline: 'ship it today',
        },
      ]);
      expect(await matchedIds('"stadium"*')).toEqual([SOURCE_ID]);
      expect(await matchedIds('"orbit"*')).toEqual([SOURCE_ID]);
      await checkFtsIntegrity();
    });

    test('新しい索引文書で前回のキーワードを保つ指定なら、キーワードの列を空にする', async () => {
      await insertProduct({ id: SOURCE_ID });

      await createRepository().upsert(
        TARGET,
        SOURCE_ID,
        writeOf({
          keywords: { kind: 'keep' },
          keywordStatus: 'pending',
          extractionInputHash: null,
        }),
      );

      expect(await readDocument(SOURCE_ID)).toMatchObject({
        keywords: '',
        keywordStatus: 'pending',
        extractionInputHash: null,
      });
    });

    test('新しい版で元テキスト・キーワード・状態・ハッシュ・状態の変更日時を更新し、全文検索の索引も新しい内容にする', async () => {
      await insertProduct({ id: SOURCE_ID });
      const repository = createRepository();
      await repository.upsert(TARGET, SOURCE_ID, writeOf());

      const result = await repository.upsert(
        TARGET,
        SOURCE_ID,
        writeOf({
          sourceVersion: 200,
          texts: { name: 'Orbit Board', tagline: 'plan launches' },
          keywords: { kind: 'set', value: 'planner' },
          keywordStatus: 'fallback',
          extractionInputHash: null,
          statusChangedAt: LATER,
        }),
      );

      expect(result).toBe('written');
      expect(await readDocument(SOURCE_ID)).toMatchObject({
        sourceVersion: 200,
        keywords: 'planner',
        keywordStatus: 'fallback',
        extractionInputHash: null,
        statusChangedAt: LATER,
        name: 'Orbit Board',
        tagline: 'plan launches',
      });
      expect(await matchedIds('"stadium"*')).toEqual([]);
      expect(await matchedIds('"rocket"*')).toEqual([]);
      expect(await matchedIds('"board"*')).toEqual([SOURCE_ID]);
      expect(await matchedIds('"planner"*')).toEqual([SOURCE_ID]);
      await checkFtsIntegrity();
    });

    test('同じ版の書き込みは上書きし、重複して届いても同じ結果にする', async () => {
      await insertProduct({ id: SOURCE_ID });
      const repository = createRepository();
      await repository.upsert(TARGET, SOURCE_ID, writeOf());
      const first = await readDocuments();

      const result = await repository.upsert(TARGET, SOURCE_ID, writeOf());

      expect(result).toBe('written');
      expect(await readDocuments()).toEqual(first);
      await checkFtsIntegrity();
    });

    test('保存済みより古い版の書き込みは無視してskippedを返す', async () => {
      await insertProduct({ id: SOURCE_ID });
      const repository = createRepository();
      await repository.upsert(TARGET, SOURCE_ID, writeOf());
      const stored = await readDocuments();

      const result = await repository.upsert(
        TARGET,
        SOURCE_ID,
        writeOf({
          sourceVersion: 99,
          texts: { name: 'Old Name', tagline: 'old' },
          keywords: { kind: 'set', value: 'stale' },
          statusChangedAt: LATER,
        }),
      );

      expect(result).toBe('skipped');
      expect(await readDocuments()).toEqual(stored);
      expect(await matchedIds('"stale"*')).toEqual([]);
    });

    test.each<[string, ProductInput | undefined]>([
      ['存在しない', undefined],
      ['論理削除済みである', { id: SOURCE_ID, deletedAt: NOW }],
      ['索引の対象外である', { id: SOURCE_ID, visible: false }],
    ])(
      '元データが%s場合は索引文書を作らずskippedを返す',
      async (_label, product) => {
        if (product !== undefined) {
          await insertProduct(product);
        }

        const result = await createRepository().upsert(
          TARGET,
          SOURCE_ID,
          writeOf(),
        );

        expect(result).toBe('skipped');
        expect(await readDocuments()).toEqual([]);
      },
    );

    test('元データが削除された後の書き込みは、残っている更新待ちの行より新しい版でも書き換えない', async () => {
      await insertProduct({ id: SOURCE_ID, deletedAt: NOW });
      await db.insert(fixtureProductSearchDocuments).values({
        sourceId: SOURCE_ID,
        sourceVersion: 0,
        keywordStatus: 'pending',
        statusChangedAt: NOW,
      });
      const stored = await readDocuments();

      const result = await createRepository().upsert(
        TARGET,
        SOURCE_ID,
        writeOf(),
      );

      expect(result).toBe('skipped');
      expect(await readDocuments()).toEqual(stored);
      expect(await matchedIds('"stadium"*')).toEqual([]);
    });

    test('前回のキーワードを保つ指定なら、キーワードの列を変えずに元テキストと状態を更新する', async () => {
      await insertProduct({ id: SOURCE_ID });
      const repository = createRepository();
      await repository.upsert(TARGET, SOURCE_ID, writeOf());

      const result = await repository.upsert(
        TARGET,
        SOURCE_ID,
        writeOf({
          sourceVersion: 200,
          texts: { name: 'Orbit Board', tagline: 'plan launches' },
          keywords: { kind: 'keep' },
          keywordStatus: 'pending',
          extractionInputHash: null,
          statusChangedAt: LATER,
        }),
      );

      expect(result).toBe('written');
      expect(await readDocument(SOURCE_ID)).toMatchObject({
        sourceVersion: 200,
        keywords: 'rocket orbit',
        keywordStatus: 'pending',
        extractionInputHash: null,
        statusChangedAt: LATER,
        name: 'Orbit Board',
        tagline: 'plan launches',
      });
      expect(await matchedIds('"rocket"*')).toEqual([SOURCE_ID]);
      expect(await matchedIds('"board"*')).toEqual([SOURCE_ID]);
      expect(await matchedIds('"stadium"*')).toEqual([]);
      await checkFtsIntegrity();
    });

    test('他の元データの索引文書を書き換えない', async () => {
      await insertProduct({ id: SOURCE_ID });
      await insertProduct({ id: OTHER_SOURCE_ID });
      const repository = createRepository();
      await repository.upsert(TARGET, OTHER_SOURCE_ID, writeOf());

      await repository.upsert(
        TARGET,
        SOURCE_ID,
        writeOf({ sourceVersion: 300, keywords: { kind: 'set', value: 'x' } }),
      );

      expect(await readDocument(OTHER_SOURCE_ID)).toMatchObject({
        sourceVersion: 100,
        keywords: 'rocket orbit',
      });
    });

    test('索引の定義の元テキストの列の値が書き込みに無ければ、何も書かずに例外にする', async () => {
      await insertProduct({ id: SOURCE_ID });

      await expect(
        createRepository().upsert(
          TARGET,
          SOURCE_ID,
          writeOf({ texts: { name: 'Launch Stadium' } }),
        ),
      ).rejects.toThrow(TypeError);
      expect(await readDocuments()).toEqual([]);
    });
  });

  describe('findState', () => {
    test('索引文書が無ければundefinedを返す', async () => {
      expect(await createRepository().findState(TARGET, SOURCE_ID)).toBe(
        undefined,
      );
    });

    test('保存済みの版・状態・ハッシュを返す', async () => {
      await insertProduct({ id: SOURCE_ID });
      const repository = createRepository();
      await repository.upsert(TARGET, SOURCE_ID, writeOf());

      expect(await repository.findState(TARGET, SOURCE_ID)).toEqual({
        sourceVersion: 100,
        keywordStatus: 'extracted',
        extractionInputHash: 'hash-1',
      });
    });

    test('ハッシュが無ければundefinedにする', async () => {
      await insertProduct({ id: SOURCE_ID });
      const repository = createRepository();
      await repository.upsert(
        TARGET,
        SOURCE_ID,
        writeOf({ keywordStatus: 'disabled', extractionInputHash: null }),
      );

      expect(await repository.findState(TARGET, SOURCE_ID)).toEqual({
        sourceVersion: 100,
        keywordStatus: 'disabled',
        extractionInputHash: undefined,
      });
    });
  });

  describe('delete', () => {
    test('索引文書を消し、全文検索の索引からも消して、他の元データの索引文書を残す', async () => {
      await insertProduct({ id: SOURCE_ID });
      await insertProduct({ id: OTHER_SOURCE_ID });
      const repository = createRepository();
      await repository.upsert(TARGET, SOURCE_ID, writeOf());
      await repository.upsert(
        TARGET,
        OTHER_SOURCE_ID,
        writeOf({ texts: { name: 'Orbit Board', tagline: '' } }),
      );

      await repository.delete(TARGET, SOURCE_ID);

      expect((await readDocuments()).map((row) => row.sourceId)).toEqual([
        OTHER_SOURCE_ID,
      ]);
      expect(await matchedIds('"stadium"*')).toEqual([]);
      expect(await matchedIds('"board"*')).toEqual([OTHER_SOURCE_ID]);
      await checkFtsIntegrity();
    });

    test('索引文書が無くても成功する', async () => {
      await expect(
        createRepository().delete(TARGET, SOURCE_ID),
      ).resolves.toBeUndefined();
    });
  });

  describe('findSourceIdsForReextraction', () => {
    const PENDING_BEFORE = new Date('2026-10-31T02:00:00.000Z');
    const at = (offsetMilliseconds: number) =>
      new Date(PENDING_BEFORE.getTime() + offsetMilliseconds);

    const insertDocuments = async (
      rows: readonly [string, IndexWrite['keywordStatus'], Date][],
    ) => {
      await db.insert(fixtureProductSearchDocuments).values(
        rows.map(([sourceId, keywordStatus, statusChangedAt]) => ({
          sourceId,
          keywordStatus,
          statusChangedAt,
        })),
      );
    };

    test('縮退した索引文書と、基準日時より前から更新待ちの索引文書を、状態の変更日時の昇順で返す', async () => {
      await insertDocuments([
        ['fallback-new', 'fallback', at(60_000)],
        ['pending-old', 'pending', at(-60_000)],
        ['pending-just-before', 'pending', at(-1)],
        ['pending-at-cutoff', 'pending', at(0)],
        ['pending-new', 'pending', at(1)],
        ['fallback-old', 'fallback', at(-120_000)],
        ['extracted-old', 'extracted', at(-120_000)],
        ['unsupported-old', 'unsupported', at(-120_000)],
        ['disabled-old', 'disabled', at(-120_000)],
      ]);

      const ids = await createRepository().findSourceIdsForReextraction(
        TARGET,
        PENDING_BEFORE,
        200,
      );

      expect(ids).toEqual([
        'fallback-old',
        'pending-old',
        'pending-just-before',
        'fallback-new',
      ]);
    });

    test('上限の件数までを古い順に返す', async () => {
      await insertDocuments([
        ['c', 'fallback', at(-1000)],
        ['a', 'fallback', at(-3000)],
        ['b', 'pending', at(-2000)],
      ]);

      const ids = await createRepository().findSourceIdsForReextraction(
        TARGET,
        PENDING_BEFORE,
        2,
      );

      expect(ids).toEqual(['a', 'b']);
    });

    test('対象が無ければ空の一覧を返す', async () => {
      await insertDocuments([['extracted', 'extracted', at(-1000)]]);

      expect(
        await createRepository().findSourceIdsForReextraction(
          TARGET,
          PENDING_BEFORE,
          200,
        ),
      ).toEqual([]);
    });
  });

  test.each<[string, (store: SearchIndexStore) => Promise<unknown>]>([
    ['findState', (store) => store.findState('unknown', SOURCE_ID)],
    ['upsert', (store) => store.upsert('unknown', SOURCE_ID, writeOf())],
    ['delete', (store) => store.delete('unknown', SOURCE_ID)],
    [
      'findSourceIdsForReextraction',
      (store) => store.findSourceIdsForReextraction('unknown', NOW, 1),
    ],
  ])(
    '%sは登録されていない検索対象を呼び出し側の誤りとして例外にする',
    async (_label, call) => {
      await expect(call(createRepository())).rejects.toThrow(
        SearchTargetRegistryError,
      );
    },
  );
});

describe('D1上の全文検索の索引と検索のSQL断片', () => {
  const indexProducts = async (
    rows: readonly {
      readonly id: string;
      readonly name?: string;
      readonly tagline?: string;
      readonly keywords?: string;
      readonly visible?: boolean;
    }[],
  ) => {
    const repository = createRepository();
    for (const {
      id,
      name = '',
      tagline = '',
      keywords = '',
      visible,
    } of rows) {
      await insertProduct({ id, visible: true });
      await repository.upsert(
        TARGET,
        id,
        writeOf({
          texts: { name, tagline },
          keywords: { kind: 'set', value: keywords },
        }),
      );
      if (visible === false) {
        await db
          .update(fixtureProducts)
          .set({ visible: false })
          .where(eq(fixtureProducts.id, id));
      }
    }
  };

  test('D1が前方一致の索引の長さの指定を付けた全文検索の索引を作る', async () => {
    const row = await db.get<{ sql: string }>(
      sql`SELECT sql FROM sqlite_master WHERE name = ${fixtureSearchIndex.ftsTableName}`,
    );

    expect(row?.sql).toContain("prefix='2 3'");
    expect(row?.sql).toContain("tokenize='unicode61 remove_diacritics 2'");
  });

  test.each([
    ['2文字の前方一致', '"st"*'],
    ['3文字の前方一致', '"sta"*'],
    ['前方一致の索引より長い前方一致', '"stadi"*'],
    ['大文字の検索語', '"STADIUM"*'],
  ])('%sで一致する', async (_label, matchExpression) => {
    await indexProducts([
      { id: 'match', name: 'Launch Stadium' },
      { id: 'no-match', name: 'Orbit Board' },
    ]);

    expect(await matchedIds(matchExpression)).toEqual(['match']);
  });

  test('日本語の語の先頭からの前方一致で一致し、語の途中からは一致しない', async () => {
    await indexProducts([{ id: 'ja', keywords: 'タスク管理ツール' }]);

    expect(await matchedIds('"タスク"*')).toEqual(['ja']);
    expect(await matchedIds('"管理"*')).toEqual([]);
  });

  test('発音区別符号の違いを無視して照合する', async () => {
    await indexProducts([{ id: 'accent', tagline: 'Café résumé' }]);

    expect(await matchedIds('"cafe"*')).toEqual(['accent']);
    expect(await matchedIds('"resume"')).toEqual(['accent']);
  });

  test('一致した列の重みが大きい順に並び、外側の条件で索引の対象外の元データを除く', async () => {
    await indexProducts([
      { id: 'keywords-match', keywords: 'stadium' },
      { id: 'name-match', name: 'Launch Stadium' },
      { id: 'tagline-match', tagline: 'stadium tour' },
      { id: 'hidden-match', name: 'Hidden Stadium', visible: false },
      { id: 'no-match', name: 'Orbit Board' },
    ]);

    expect(await matchedIds('"stadium"*')).toEqual([
      'name-match',
      'tagline-match',
      'keywords-match',
    ]);
  });

  test('索引の定義の重みを入れ替えると、同じ索引でも並び順が入れ替わる', async () => {
    await indexProducts([
      { id: 'keywords-match', keywords: 'stadium' },
      { id: 'name-match', name: 'Launch Stadium' },
      { id: 'tagline-match', tagline: 'stadium tour' },
    ]);
    const reversed = defineFixtureSearchIndex({
      name: 1,
      tagline: 5,
      keywords: 10,
    });

    const results = await searchVisibleProducts(reversed, '"stadium"*');

    expect(results.map((row) => row.id)).toEqual([
      'keywords-match',
      'tagline-match',
      'name-match',
    ]);
  });

  test('関連度の式の値は、重みの大きい列で一致した行ほど小さい', async () => {
    await indexProducts([
      { id: 'keywords-match', keywords: 'stadium' },
      { id: 'name-match', name: 'Launch Stadium' },
    ]);
    const fts = sql.raw(fixtureSearchIndex.ftsTableName);

    const rows = await db.all<{ source_id: string; rank: number }>(
      sql`SELECT d.source_id AS source_id, ${bm25Rank(fixtureSearchIndex)} AS rank FROM ${fts} JOIN ${fixtureProductSearchDocuments} AS d ON d.id = ${fts}.rowid WHERE ${fts} MATCH ${'"stadium"*'}`,
    );
    const rankOf = (id: string) =>
      rows.find((row) => row.source_id === id)?.rank ?? Number.NaN;

    expect(rankOf('name-match')).toBeLessThan(rankOf('keywords-match'));
  });

  test('演算子や列の指定に当たる語を引用符で囲んだ検索式は、構文の誤りにならず文字列として照合する', async () => {
    await indexProducts([{ id: 'plain', name: 'NOT a name' }]);

    expect(await matchedIds('"NOT"*')).toEqual(['plain']);
    expect(await matchedIds('"name:x"*')).toEqual([]);
    expect(await matchedIds('"a""b"*')).toEqual([]);
  });
});

describe('Workers統合テスト専用の検索対象', () => {
  test('検索対象の一覧への登録の検証に通る', () => {
    expect(() =>
      createSearchTargetRegistry([fixtureSearchTarget]),
    ).not.toThrow();
  });

  test('元データの読み取りは、索引の対象の元データだけを更新日時のミリ秒を版にして返す', async () => {
    await insertProduct({ id: SOURCE_ID, name: '名前', tagline: '一言' });
    await insertProduct({ id: OTHER_SOURCE_ID, deletedAt: NOW });

    expect(await fixtureSearchTarget.read(db, SOURCE_ID)).toEqual({
      version: NOW.getTime(),
      fields: { name: '名前', tagline: '一言', description: '' },
    });
    expect(await fixtureSearchTarget.read(db, OTHER_SOURCE_ID)).toBe(undefined);
  });
});
