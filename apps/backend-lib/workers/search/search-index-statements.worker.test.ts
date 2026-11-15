import { env } from 'cloudflare:workers';
import { eq, inArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { ftsRankedSources } from '../../../db/search/fts-query.ts';
import { MAX_SEARCH_SOURCE_ID_LENGTH } from '../../core/messaging/contracts/search-index-refresh.ts';
import type { IndexWrite } from '../../core/search/ports.ts';
import { D1SearchIndexRepository } from './search-index-repository.ts';
import {
  createSearchIndexStatements,
  MAX_SOURCE_IDS_PER_DELETE_STATEMENT,
} from './search-index-statements.ts';
import {
  createSearchTargetRegistry,
  SearchTargetRegistryError,
} from './search-target-definition.ts';
import {
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

const CREATED_AT = new Date('2026-10-31T03:04:05.678Z');
const EDITED_AT = new Date('2026-10-31T04:00:00.000Z');

const D1_MAX_BOUND_PARAMETERS = 100;

const INVALID_SOURCE_IDS: readonly (readonly [string, string])[] = [
  ['空の文字列', ''],
  ['上限より長い文字列', 'x'.repeat(MAX_SEARCH_SOURCE_ID_LENGTH + 1)],
];

// 元データの1行は7列のため、1文のバインド変数がD1の上限に収まる行数ずつ追加する
const PRODUCTS_PER_INSERT = 10;

const db = createDatabase(env.DB);
const registry = createSearchTargetRegistry([fixtureSearchTarget]);
const statements = createSearchIndexStatements(db, registry);

const extractedWrite: IndexWrite = {
  sourceVersion: CREATED_AT.getTime(),
  texts: { name: 'Launch Stadium', tagline: 'ship it today' },
  keywords: { kind: 'set', value: 'rocket orbit' },
  keywordStatus: 'extracted',
  extractionInputHash: 'hash-1',
  statusChangedAt: CREATED_AT,
};

const productOf = (id: string, name = 'Launch Stadium') => ({
  id,
  name,
  tagline: 'ship it today',
  description: '',
  visible: true,
  updatedAt: CREATED_AT,
  deletedAt: null,
});

type FixtureProduct = ReturnType<typeof productOf>;

interface QueryInspectable {
  getQuery(): { readonly params: readonly unknown[] };
}

const boundParameterCount = (statement: BatchItem<'sqlite'>): number =>
  (statement as unknown as QueryInspectable).getQuery().params.length;

const chunksOf = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

const sourceIdsOf = (count: number): string[] =>
  Array.from(
    { length: count },
    (_, index) => `source-${String(index).padStart(4, '0')}`,
  );

const insertIndexedProducts = async (
  products: readonly FixtureProduct[],
): Promise<void> => {
  for (const chunk of chunksOf(products, PRODUCTS_PER_INSERT)) {
    await db.insert(fixtureProducts).values(chunk);
  }
  const repository = new D1SearchIndexRepository(db, registry);
  for (const product of products) {
    await repository.upsert(TARGET, product.id, {
      ...extractedWrite,
      texts: { name: product.name, tagline: product.tagline },
    });
  }
};

const readDocument = async (sourceId: string) => {
  const [row] = await db
    .select()
    .from(fixtureProductSearchDocuments)
    .where(eq(fixtureProductSearchDocuments.sourceId, sourceId));
  return row;
};

const countDocuments = async (): Promise<number> =>
  (await db.select().from(fixtureProductSearchDocuments)).length;

const matchedSourceIds = async (matchExpression: string): Promise<string[]> =>
  (
    await db.all<{ source_id: string }>(
      sql`SELECT source_id FROM (${ftsRankedSources(fixtureSearchIndex, matchExpression)}) ORDER BY source_id`,
    )
  ).map((row) => row.source_id);

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

describe('createSearchIndexStatements', () => {
  describe('markPending', () => {
    test('ドメインの作成と同じ一括の書き込みで、版0・更新待ち・空の元テキストとキーワードの索引文書を作る', async () => {
      await db.batch([
        db.insert(fixtureProducts).values(productOf(SOURCE_ID)),
        statements.markPending(TARGET, SOURCE_ID, CREATED_AT),
      ]);

      expect(await readDocument(SOURCE_ID)).toEqual({
        id: expect.any(Number) as unknown,
        sourceId: SOURCE_ID,
        sourceVersion: 0,
        keywords: '',
        keywordStatus: 'pending',
        extractionInputHash: null,
        statusChangedAt: CREATED_AT,
        name: '',
        tagline: '',
      });
      await checkFtsIntegrity();
    });

    test('ドメインの編集と同じ一括の書き込みで、既存の索引文書の状態と状態の変更日時だけを更新待ちに変え、版・キーワード・ハッシュ・元テキストを保つ', async () => {
      await insertIndexedProducts([productOf(SOURCE_ID)]);

      await db.batch([
        db
          .update(fixtureProducts)
          .set({ name: 'Orbit Board', updatedAt: EDITED_AT })
          .where(eq(fixtureProducts.id, SOURCE_ID)),
        statements.markPending(TARGET, SOURCE_ID, EDITED_AT),
      ]);

      expect(await readDocument(SOURCE_ID)).toMatchObject({
        sourceVersion: CREATED_AT.getTime(),
        keywords: 'rocket orbit',
        keywordStatus: 'pending',
        extractionInputHash: 'hash-1',
        statusChangedAt: EDITED_AT,
        name: 'Launch Stadium',
        tagline: 'ship it today',
      });
      expect(await matchedSourceIds('"stadium"*')).toEqual([SOURCE_ID]);
      await checkFtsIntegrity();
    });

    test('他の元データの索引文書を書き換えない', async () => {
      await insertIndexedProducts([productOf(OTHER_SOURCE_ID)]);
      await db.insert(fixtureProducts).values(productOf(SOURCE_ID));

      await db.batch([statements.markPending(TARGET, SOURCE_ID, EDITED_AT)]);

      expect(await readDocument(OTHER_SOURCE_ID)).toMatchObject({
        keywordStatus: 'extracted',
        statusChangedAt: CREATED_AT,
      });
    });

    test('一括の書き込みの中の文が失敗すると、更新待ちの印も残さない', async () => {
      await db.insert(fixtureProducts).values(productOf(SOURCE_ID));

      await expect(
        db.batch([
          statements.markPending(TARGET, SOURCE_ID, EDITED_AT),
          db.insert(fixtureProducts).values(productOf(SOURCE_ID)),
        ]),
      ).rejects.toThrow();

      expect(await countDocuments()).toBe(0);
    });

    test.each(INVALID_SOURCE_IDS)(
      '元データの識別子が%sなら、ドメインの一括の書き込みを確定する前に文を作る時点で例外にする',
      (_, sourceId) => {
        expect(() =>
          statements.markPending(TARGET, sourceId, CREATED_AT),
        ).toThrow(RangeError);
      },
    );

    test('上限の長さの元データの識別子は受け付ける', async () => {
      const sourceId = 'x'.repeat(MAX_SEARCH_SOURCE_ID_LENGTH);

      await db.batch([statements.markPending(TARGET, sourceId, CREATED_AT)]);

      expect(await readDocument(sourceId)).toBeDefined();
    });

    test('登録されていない検索対象は呼び出し側の誤りとして例外にする', () => {
      expect(() =>
        statements.markPending('unregistered-target', SOURCE_ID, CREATED_AT),
      ).toThrow(SearchTargetRegistryError);
    });
  });

  describe('deleteSources', () => {
    test('識別子を上限の件数ずつに分けた削除の文を返し、各文のバインド変数をD1の上限に収める', () => {
      const deletes = statements.deleteSources(TARGET, sourceIdsOf(181));

      expect(MAX_SOURCE_IDS_PER_DELETE_STATEMENT).toBe(90);
      expect(deletes.map(boundParameterCount)).toEqual([90, 90, 1]);
      expect(
        deletes.every(
          (statement) =>
            boundParameterCount(statement) <= D1_MAX_BOUND_PARAMETERS,
        ),
      ).toBe(true);
    });

    test('91件以上の削除を、ドメインの削除と同じ一括の書き込みで成功させ、全文検索の索引からも消して、他の元データの索引文書を残す', async () => {
      const sourceIds = sourceIdsOf(95);
      await insertIndexedProducts([
        ...sourceIds.map((id) => productOf(id)),
        productOf(OTHER_SOURCE_ID, 'Orbit Board'),
      ]);
      const [firstDomainDelete, ...restDomainDeletes] = chunksOf(
        sourceIds,
        MAX_SOURCE_IDS_PER_DELETE_STATEMENT,
      ).map((chunk) =>
        db.delete(fixtureProducts).where(inArray(fixtureProducts.id, chunk)),
      );
      const deletes = statements.deleteSources(TARGET, sourceIds);
      if (firstDomainDelete === undefined) {
        throw new Error('削除の文がありません');
      }

      await db.batch([firstDomainDelete, ...restDomainDeletes, ...deletes]);

      expect(deletes).toHaveLength(2);
      expect(await countDocuments()).toBe(1);
      expect(await readDocument(OTHER_SOURCE_ID)).toBeDefined();
      expect(await matchedSourceIds('"stadium"*')).toEqual([]);
      expect(await matchedSourceIds('"orbit"*')).toEqual([OTHER_SOURCE_ID]);
      await checkFtsIntegrity();
    });

    test('一括の書き込みの中の文が失敗すると、索引文書を消さない', async () => {
      await insertIndexedProducts([productOf(SOURCE_ID)]);
      const [first, ...rest] = statements.deleteSources(TARGET, [SOURCE_ID]);
      if (first === undefined) {
        throw new Error('削除の文がありません');
      }

      await expect(
        db.batch([
          first,
          ...rest,
          db.insert(fixtureProducts).values(productOf(SOURCE_ID)),
        ]),
      ).rejects.toThrow();

      expect(await readDocument(SOURCE_ID)).toBeDefined();
    });

    test('索引文書の無い元データの削除も成功する', async () => {
      const [first, ...rest] = statements.deleteSources(TARGET, [SOURCE_ID]);
      if (first === undefined) {
        throw new Error('削除の文がありません');
      }

      await db.batch([first, ...rest]);

      expect(await countDocuments()).toBe(0);
    });

    test('識別子が無ければ文を返さない', () => {
      expect(statements.deleteSources(TARGET, [])).toEqual([]);
    });

    test.each(INVALID_SOURCE_IDS)(
      '元データの識別子に%sがあれば、ドメインの一括の書き込みを確定する前に文を作る時点で例外にする',
      (_, sourceId) => {
        expect(() =>
          statements.deleteSources(TARGET, [SOURCE_ID, sourceId]),
        ).toThrow(RangeError);
      },
    );

    test('登録されていない検索対象は呼び出し側の誤りとして例外にする', () => {
      expect(() =>
        statements.deleteSources('unregistered-target', [SOURCE_ID]),
      ).toThrow(SearchTargetRegistryError);
    });
  });
});
