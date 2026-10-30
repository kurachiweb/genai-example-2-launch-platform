import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  camelCase,
  getTableConfig,
  snakeCase,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import {
  KEYWORD_STATUSES,
  searchDocumentColumns,
  searchDocumentStatusIndex,
  searchTextColumn,
  type KeywordStatus,
} from './search-documents.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const probeSearchDocuments = snakeCase.table(
  'probe_search_documents',
  {
    ...searchDocumentColumns(),
    name: searchTextColumn('name'),
    tagline: searchTextColumn('tagline'),
  },
  (table) => [searchDocumentStatusIndex('probe_search_documents', table)],
);

const config = getTableConfig(probeSearchDocuments);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string | undefined =>
  (column as SQLiteColumn & { mode?: string }).mode;

const expectNoGeneratedValue = (column: TableColumn) => {
  expect(column.defaultFn).toBeUndefined();
  expect(column.onUpdateFn).toBeUndefined();
};

describe('KEYWORD_STATUSES', () => {
  test('キーワードの状態は更新待ち・抽出済み・縮退・非対応言語・無効の5つになる', () => {
    expect(KEYWORD_STATUSES).toEqual([
      'pending',
      'extracted',
      'fallback',
      'unsupported',
      'disabled',
    ]);
  });
});

describe('searchDocumentColumns', () => {
  test('共通の列の後に元テキストの列が並び、列名はスネークケースになる', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'source_id',
      'source_version',
      'keywords',
      'keyword_status',
      'extraction_input_hash',
      'status_changed_at',
      'name',
      'tagline',
    ]);
  });

  test('列名を明示しているため、キャメルケースへ変換するテーブルでも列名が変わらない', () => {
    const camelProbe = camelCase.table('camel_probe_search_documents', {
      ...searchDocumentColumns(),
      bodyText: searchTextColumn('body_text'),
    });

    expect(
      getTableConfig(camelProbe).columns.map((column) => column.name),
    ).toEqual([
      'id',
      'source_id',
      'source_version',
      'keywords',
      'keyword_status',
      'extraction_input_hash',
      'status_changed_at',
      'body_text',
    ]);
  });

  test('idは全文検索の索引のrowidに使うAUTOINCREMENT無しの整数の主キーで、SQLiteの採番に任せる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('integer');
    expect(id.columnType).toBe('SQLiteInteger');
    expect(id.primary).toBe(true);
    expect(id.notNull).toBe(true);
    expect(
      (id as SQLiteColumn & { autoIncrement: boolean }).autoIncrement,
    ).toBe(false);
    expect(id.hasDefault).toBe(true);
    expect(id.default).toBeUndefined();
    expect(id.isUnique).toBe(false);
    expectNoGeneratedValue(id);
  });

  test('source_idは元データの識別子を持つ、NOT NULLで一意なテキストになる', () => {
    const sourceId = columnOf('source_id');

    expect(sourceId.getSQLType()).toBe('text');
    expect(sourceId.notNull).toBe(true);
    expect(sourceId.isUnique).toBe(true);
    expect(sourceId.primary).toBe(false);
    expect(sourceId.hasDefault).toBe(false);
    expectNoGeneratedValue(sourceId);
  });

  test('source_versionはNOT NULLの整数で、既定値は0になる', () => {
    const sourceVersion = columnOf('source_version');

    expect(sourceVersion.getSQLType()).toBe('integer');
    expect(sourceVersion.notNull).toBe(true);
    expect(sourceVersion.isUnique).toBe(false);
    expect(sourceVersion.default).toBe(0);
    expectNoGeneratedValue(sourceVersion);
  });

  test('keywordsはNOT NULLのテキストで、既定値は空文字列になる', () => {
    const keywords = columnOf('keywords');

    expect(keywords.getSQLType()).toBe('text');
    expect(keywords.notNull).toBe(true);
    expect(keywords.default).toBe('');
    expectNoGeneratedValue(keywords);
  });

  test('keyword_statusは状態の値に限るNOT NULLのテキストで、既定値はpendingになる', () => {
    const keywordStatus = columnOf('keyword_status');

    expect(keywordStatus.getSQLType()).toBe('text');
    expect(keywordStatus.notNull).toBe(true);
    expect(keywordStatus.default).toBe('pending');
    expect(keywordStatus.enumValues).toEqual([...KEYWORD_STATUSES]);
    expectNoGeneratedValue(keywordStatus);
  });

  test('extraction_input_hashはNULLを許すテキストで、既定値を持たない', () => {
    const extractionInputHash = columnOf('extraction_input_hash');

    expect(extractionInputHash.getSQLType()).toBe('text');
    expect(extractionInputHash.notNull).toBe(false);
    expect(extractionInputHash.isUnique).toBe(false);
    expect(extractionInputHash.hasDefault).toBe(false);
    expectNoGeneratedValue(extractionInputHash);
  });

  test('status_changed_atはUTCミリ秒の整数でNOT NULLになり、既定値を持たない', () => {
    const statusChangedAt = columnOf('status_changed_at');

    expect(statusChangedAt.getSQLType()).toBe('integer');
    expect(statusChangedAt.columnType).toBe('SQLiteTimestamp');
    expect(modeOf(statusChangedAt)).toBe('timestamp_ms');
    expect(statusChangedAt.notNull).toBe(true);
    expect(statusChangedAt.hasDefault).toBe(false);
    expectNoGeneratedValue(statusChangedAt);
  });

  test('追加時はidと既定値を持つ列を省け、状態の列の型はKeywordStatusになる', () => {
    type Insert = typeof probeSearchDocuments.$inferInsert;
    type Select = typeof probeSearchDocuments.$inferSelect;

    expectTypeOf<Insert['id']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Insert['sourceId']>().toEqualTypeOf<string>();
    expectTypeOf<Insert['statusChangedAt']>().toEqualTypeOf<Date>();
    expectTypeOf<Insert['keywordStatus']>().toEqualTypeOf<
      KeywordStatus | undefined
    >();
    expectTypeOf<Select['keywordStatus']>().toEqualTypeOf<KeywordStatus>();
    expectTypeOf<Select['extractionInputHash']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<Select['name']>().toEqualTypeOf<string>();
  });

  test('呼び出しごとに別の列ビルダーを返す', () => {
    const first = searchDocumentColumns();
    const second = searchDocumentColumns();

    for (const key of Object.keys(first) as (keyof typeof first)[]) {
      expect(second[key]).not.toBe(first[key]);
    }
  });
});

describe('searchTextColumn', () => {
  test.each(['name', 'tagline'])(
    '元テキストの列%sは、NOT NULLで既定値が空文字列のテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.default).toBe('');
      expectNoGeneratedValue(column);
    },
  );

  test('呼び出しごとに別の列ビルダーを返す', () => {
    expect(searchTextColumn('name')).not.toBe(searchTextColumn('name'));
  });
});

describe('searchDocumentStatusIndex', () => {
  test('状態と状態を変えた日時の順に、一意でない索引を<テーブル>_status_idxの名前で持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'probe_search_documents_status_idx',
        columns: ['keyword_status', 'status_changed_at'],
        unique: false,
      },
    ]);
  });
});
