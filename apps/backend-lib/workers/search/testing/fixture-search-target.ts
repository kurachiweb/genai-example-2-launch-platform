import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import {
  searchDocumentColumns,
  searchDocumentStatusIndex,
  searchTextColumn,
} from '../../../../db/schema/_shared/search-documents.ts';
import {
  defineSearchIndex,
  type SearchIndexDefinition,
} from '../../../../db/search/search-index-definition.ts';
import {
  renderSearchIndexDropSql,
  renderSearchIndexSql,
  STATEMENT_SEPARATOR,
} from '../../../../db/search/search-index-sql.ts';
import { defineSearchTarget } from '../search-target-definition.ts';

export const FIXTURE_SEARCH_TARGET_NAME = 'fixture-product';

export const fixtureProducts = snakeCase.table('fixture_products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tagline: text('tagline').notNull(),
  description: text('description').notNull(),
  visible: integer('visible', { mode: 'boolean' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
});

export const fixtureProductSearchDocuments = snakeCase.table(
  'fixture_product_search_documents',
  {
    ...searchDocumentColumns(),
    name: searchTextColumn('name'),
    tagline: searchTextColumn('tagline'),
  },
  (table) => [
    searchDocumentStatusIndex('fixture_product_search_documents', table),
  ],
);

export interface FixtureIndexWeights {
  readonly name: number;
  readonly tagline: number;
  readonly keywords: number;
}

export const FIXTURE_INDEX_WEIGHTS: FixtureIndexWeights = {
  name: 10,
  tagline: 5,
  keywords: 1,
};

// 重みは作成文に含まれないため、同じ全文検索の索引に別の重みの定義を重ねて関連度の並び順を確かめられる
export function defineFixtureSearchIndex(
  weights: FixtureIndexWeights,
): SearchIndexDefinition {
  return defineSearchIndex({
    documents: fixtureProductSearchDocuments,
    textColumns: [
      { column: fixtureProductSearchDocuments.name, weight: weights.name },
      {
        column: fixtureProductSearchDocuments.tagline,
        weight: weights.tagline,
      },
    ],
    keywordsWeight: weights.keywords,
  });
}

export const fixtureSearchIndex = defineFixtureSearchIndex(
  FIXTURE_INDEX_WEIGHTS,
);

const indexableProduct = (sourceId: string): SQL | undefined =>
  and(
    eq(fixtureProducts.id, sourceId),
    eq(fixtureProducts.visible, true),
    isNull(fixtureProducts.deletedAt),
  );

export const fixtureSearchTarget = defineSearchTarget({
  name: FIXTURE_SEARCH_TARGET_NAME,
  fields: {
    name: { format: 'plain', textColumn: true, extract: true },
    tagline: { format: 'plain', textColumn: true, extract: true },
    description: { format: 'markdown', textColumn: false, extract: true },
  },
  index: fixtureSearchIndex,
  documents: fixtureProductSearchDocuments,
  async read(db, sourceId) {
    const [row] = await db
      .select()
      .from(fixtureProducts)
      .where(indexableProduct(sourceId))
      .limit(1);
    return (
      row && {
        version: row.updatedAt.getTime(),
        fields: {
          name: row.name,
          tagline: row.tagline,
          description: row.description,
        },
      }
    );
  },
  isIndexable: (sourceId) =>
    sql`SELECT 1 FROM ${fixtureProducts} WHERE ${indexableProduct(sourceId)}`,
});

// drizzle-kit generateが2つのテーブル定義から出力するSQLと同じ形にする
const CREATE_TABLE_STATEMENTS: readonly string[] = [
  `CREATE TABLE fixture_products (
  id text PRIMARY KEY,
  name text NOT NULL,
  tagline text NOT NULL,
  description text NOT NULL,
  visible integer NOT NULL,
  updated_at integer NOT NULL,
  deleted_at integer
)`,
  `CREATE TABLE fixture_product_search_documents (
  id integer PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  source_version integer DEFAULT 0 NOT NULL,
  keywords text DEFAULT '' NOT NULL,
  keyword_status text DEFAULT 'pending' NOT NULL,
  extraction_input_hash text,
  status_changed_at integer NOT NULL,
  name text DEFAULT '' NOT NULL,
  tagline text DEFAULT '' NOT NULL
)`,
  'CREATE INDEX fixture_product_search_documents_status_idx ON fixture_product_search_documents (keyword_status, status_changed_at)',
];

const statementsOf = (script: string): string[] =>
  script.split(STATEMENT_SEPARATOR);

// テストの間で前の状態を残さないよう、全文検索の索引・トリガー・テーブルを消してから作り直す
export const FIXTURE_SEARCH_TARGET_SETUP_SQL: readonly string[] = [
  ...statementsOf(renderSearchIndexDropSql(fixtureSearchIndex)),
  'DROP TABLE IF EXISTS fixture_product_search_documents',
  'DROP TABLE IF EXISTS fixture_products',
  ...CREATE_TABLE_STATEMENTS,
  ...statementsOf(renderSearchIndexSql(fixtureSearchIndex)),
];

export async function setUpFixtureSearchTarget(d1: D1Database): Promise<void> {
  await d1.batch(
    FIXTURE_SEARCH_TARGET_SETUP_SQL.map((statement) => d1.prepare(statement)),
  );
}
