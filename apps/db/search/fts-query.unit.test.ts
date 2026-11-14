import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { sql } from 'drizzle-orm';
import { drizzle, type SQLiteBunDatabase } from 'drizzle-orm/bun-sqlite';
import { snakeCase, SQLiteDialect } from 'drizzle-orm/sqlite-core';

import {
  searchDocumentColumns,
  searchTextColumn,
} from '../schema/_shared/search-documents.ts';
import { bm25Rank, ftsRankedSources } from './fts-query.ts';
import {
  defineSearchIndex,
  type SearchIndexDefinition,
} from './search-index-definition.ts';
import { renderSearchIndexSql } from './search-index-sql.ts';

const probeSearchDocuments = snakeCase.table('probe_search_documents', {
  ...searchDocumentColumns(),
  name: searchTextColumn('name'),
  tagline: searchTextColumn('tagline'),
});

const defineProbeIndex = (weights: {
  name: number;
  tagline: number;
  keywords: number;
}): SearchIndexDefinition =>
  defineSearchIndex({
    documents: probeSearchDocuments,
    textColumns: [
      { column: probeSearchDocuments.name, weight: weights.name },
      { column: probeSearchDocuments.tagline, weight: weights.tagline },
    ],
    keywordsWeight: weights.keywords,
  });

const definition = defineProbeIndex({ name: 10, tagline: 5, keywords: 1 });

const CREATE_SOURCES_TABLE_SQL = `CREATE TABLE probe_products (
  id text PRIMARY KEY,
  visible integer NOT NULL
)`;

const CREATE_DOCUMENTS_TABLE_SQL = `CREATE TABLE probe_search_documents (
  id integer PRIMARY KEY,
  source_id text NOT NULL UNIQUE,
  source_version integer DEFAULT 0 NOT NULL,
  keywords text DEFAULT '' NOT NULL,
  keyword_status text DEFAULT 'pending' NOT NULL,
  extraction_input_hash text,
  status_changed_at integer NOT NULL,
  name text DEFAULT '' NOT NULL,
  tagline text DEFAULT '' NOT NULL
)`;

interface ProbeSource {
  readonly id: string;
  readonly visible?: boolean;
  readonly name?: string;
  readonly tagline?: string;
  readonly keywords?: string;
}

const dialect = new SQLiteDialect();

let client: Database;
let db: SQLiteBunDatabase;

const setUp = (target: SearchIndexDefinition, sources: ProbeSource[]) => {
  client.run(CREATE_SOURCES_TABLE_SQL);
  client.run(CREATE_DOCUMENTS_TABLE_SQL);
  client.run(renderSearchIndexSql(target));
  for (const {
    id,
    visible = true,
    name = '',
    tagline = '',
    keywords = '',
  } of sources) {
    client
      .query('INSERT INTO probe_products (id, visible) VALUES (?, ?)')
      .run(id, visible ? 1 : 0);
    client
      .query(
        'INSERT INTO probe_search_documents (source_id, name, tagline, keywords, status_changed_at) VALUES (?, ?, ?, ?, 0)',
      )
      .run(id, name, tagline, keywords);
  }
};

// ドメインの検索のクエリと同じく、副問い合わせを元データと結合して可視性で絞り、関連度の昇順で並べる
const searchVisibleProducts = (
  target: SearchIndexDefinition,
  matchExpression: string,
): { id: string; rank: number }[] =>
  db.all<{ id: string; rank: number }>(
    sql`SELECT p.id AS id, r.rank AS rank FROM probe_products AS p JOIN (${ftsRankedSources(target, matchExpression)}) AS r ON r.source_id = p.id WHERE p.visible = 1 ORDER BY r.rank, p.id`,
  );

beforeEach(() => {
  client = new Database(':memory:');
  db = drizzle({ client });
});

afterEach(() => {
  client.close();
});

describe('ftsRankedSources', () => {
  test('元データの識別子と関連度を返す副問い合わせのSQLを作り、検索式はバインド変数で渡す', () => {
    const matchExpression = '"stadium"*';

    const query = dialect.sqlToQuery(
      ftsRankedSources(definition, matchExpression),
    );

    expect(query.sql).toBe(
      'SELECT d.source_id AS source_id, bm25(probe_search_documents_fts, 10, 5, 1) AS rank FROM probe_search_documents_fts JOIN probe_search_documents AS d ON d.id = probe_search_documents_fts.rowid WHERE probe_search_documents_fts MATCH ?',
    );
    expect(query.params).toEqual([matchExpression]);
  });

  test('元データと結合した検索で、一致した列の重みが大きい順に並ぶ', () => {
    setUp(definition, [
      { id: 'keywords-match', keywords: 'stadium' },
      { id: 'name-match', name: 'Launch Stadium' },
      { id: 'tagline-match', tagline: 'stadium tour' },
      { id: 'no-match', name: 'Orbit Board' },
    ]);

    const results = searchVisibleProducts(definition, '"stadium"*');

    expect(results.map((row) => row.id)).toEqual([
      'name-match',
      'tagline-match',
      'keywords-match',
    ]);
  });

  test('索引の定義の重みを入れ替えると、並び順も入れ替わる', () => {
    const reversed = defineProbeIndex({ name: 1, tagline: 5, keywords: 10 });
    setUp(reversed, [
      { id: 'keywords-match', keywords: 'stadium' },
      { id: 'name-match', name: 'Launch Stadium' },
      { id: 'tagline-match', tagline: 'stadium tour' },
    ]);

    const results = searchVisibleProducts(reversed, '"stadium"*');

    expect(results.map((row) => row.id)).toEqual([
      'keywords-match',
      'tagline-match',
      'name-match',
    ]);
  });

  test('外側のクエリの条件で、一致した元データを絞り込める', () => {
    setUp(definition, [
      { id: 'hidden', visible: false, name: 'Hidden Stadium' },
      { id: 'visible', tagline: 'stadium tour' },
    ]);

    const results = searchVisibleProducts(definition, '"stadium"*');

    expect(results.map((row) => row.id)).toEqual(['visible']);
  });

  test('引用符を含む検索式も、SQLの構文を壊さずに照合する', () => {
    setUp(definition, [{ id: 'quoted', name: "it's launch day" }]);

    const results = searchVisibleProducts(definition, '"it\'s"*');

    expect(results.map((row) => row.id)).toEqual(['quoted']);
  });

  test('小数の重みも、そのまま関連度の計算に使う', () => {
    const fractional = defineProbeIndex({
      name: 2.5,
      tagline: 0.5,
      keywords: 1,
    });

    expect(
      dialect.sqlToQuery(ftsRankedSources(fractional, '"a"*')).sql,
    ).toContain('bm25(probe_search_documents_fts, 2.5, 0.5, 1) AS rank');
  });
});

describe('bm25Rank', () => {
  test('索引の定義の列の順に重みを並べた、バインド変数を使わないBM25の関連度の式を返す', () => {
    const query = dialect.sqlToQuery(bm25Rank(definition));

    expect(query.sql).toBe('bm25(probe_search_documents_fts, 10, 5, 1)');
    expect(query.params).toEqual([]);
  });

  test('関連度は一致した列の重みが大きいほど小さい', () => {
    setUp(definition, [
      { id: 'keywords-match', keywords: 'stadium' },
      { id: 'name-match', name: 'Launch Stadium' },
    ]);

    const results = searchVisibleProducts(definition, '"stadium"*');
    const rankOf = (id: string) =>
      results.find((row) => row.id === id)?.rank ?? Number.NaN;

    expect(rankOf('name-match')).toBeLessThan(rankOf('keywords-match'));
  });
});
