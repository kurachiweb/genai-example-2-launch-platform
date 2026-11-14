import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { getTableColumns } from 'drizzle-orm';

import {
  getTableConfig,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import {
  searchDocumentColumns,
  searchTextColumn,
} from '../schema/_shared/search-documents.ts';
import {
  defineSearchIndex,
  SEARCH_DOCUMENT_COLUMN_NAMES,
  type SearchIndexDefinition,
  SearchIndexDefinitionError,
} from './search-index-definition.ts';
import { SQLITE_KEYWORDS } from './sqlite-keywords.ts';

const probeSearchDocuments = snakeCase.table('probe_search_documents', {
  ...searchDocumentColumns(),
  name: searchTextColumn('name'),
  tagline: searchTextColumn('tagline'),
});

const otherSearchDocuments = snakeCase.table('other_search_documents', {
  ...searchDocumentColumns(),
  name: searchTextColumn('name'),
});

const probeColumns = Object.entries(getTableColumns(probeSearchDocuments));

const commonColumnEntries = probeColumns
  .filter(([key]) => key in searchDocumentColumns())
  .map(([key, column]) => [column.name, key] as const);

const columnNamed = (name: string) => {
  const entry = probeColumns.find(([, column]) => column.name === name);
  if (entry === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return entry[1];
};

const validInput = {
  documents: probeSearchDocuments,
  textColumns: [
    { column: probeSearchDocuments.name, weight: 10 },
    { column: probeSearchDocuments.tagline, weight: 5 },
  ],
  keywordsWeight: 1,
};

const expectDefinitionError = (
  input: Parameters<typeof defineSearchIndex>[0],
  message: RegExp,
) => {
  expect(() => defineSearchIndex(input)).toThrow(SearchIndexDefinitionError);
  expect(() => defineSearchIndex(input)).toThrow(message);
};

describe('SEARCH_DOCUMENT_COLUMN_NAMES', () => {
  test('searchDocumentColumnsが定義する共通の列の名前と一致する', () => {
    const table = snakeCase.table('names_search_documents', {
      ...searchDocumentColumns(),
    });

    expect(getTableConfig(table).columns.map((column) => column.name)).toEqual([
      ...SEARCH_DOCUMENT_COLUMN_NAMES,
    ]);
  });
});

describe('defineSearchIndex', () => {
  test('テーブル名・全文検索の索引の名前・DBの列名と重み・前方一致の長さの既定値を持つ定義を返す', () => {
    expect<object>(defineSearchIndex(validInput)).toEqual({
      documentsTableName: 'probe_search_documents',
      ftsTableName: 'probe_search_documents_fts',
      textColumns: [
        { name: 'name', weight: 10 },
        { name: 'tagline', weight: 5 },
      ],
      keywordsWeight: 1,
      prefixLengths: [2, 3],
    });
  });

  test('defineSearchIndexを通さずに組み立てた値は、索引の定義の型として受け取れない', () => {
    const forged = {
      documentsTableName: 'probe_search_documents; DROP TABLE users',
      ftsTableName: 'probe_search_documents_fts',
      textColumns: [{ name: 'name', weight: 10 }],
      keywordsWeight: 1,
      prefixLengths: [2, 3],
    };

    // @ts-expect-error 検証を通していない値は索引の定義の型に代入できない
    const definition: SearchIndexDefinition = forged;

    expect<object>(definition).toBe(forged);
  });

  test('前方一致の長さを指定すると、その長さを持つ', () => {
    expect(
      defineSearchIndex({ ...validInput, prefixLengths: [1, 2, 3, 4] })
        .prefixLengths,
    ).toEqual([1, 2, 3, 4]);
  });

  test('キャメルケースのキーで定義した元テキストの列も、DBの列名で持つ', () => {
    const camelSearchDocuments = snakeCase.table('camel_search_documents', {
      ...searchDocumentColumns(),
      bodyText: searchTextColumn('body_text'),
    });

    expect(
      defineSearchIndex({
        documents: camelSearchDocuments,
        textColumns: [{ column: camelSearchDocuments.bodyText, weight: 2 }],
        keywordsWeight: 1,
      }).textColumns,
    ).toEqual([{ name: 'body_text', weight: 2 }]);
  });

  test('入力の配列を後から変えても、定義は変わらない', () => {
    const textColumns = [{ column: probeSearchDocuments.name, weight: 10 }];
    const prefixLengths = [2, 3];
    const definition = defineSearchIndex({
      documents: probeSearchDocuments,
      textColumns,
      keywordsWeight: 1,
      prefixLengths,
    });

    textColumns.push({ column: probeSearchDocuments.tagline, weight: 5 });
    prefixLengths.push(4);

    expect(definition.textColumns).toEqual([{ name: 'name', weight: 10 }]);
    expect(definition.prefixLengths).toEqual([2, 3]);
  });

  describe('テーブル名', () => {
    test.each([
      'search_documents',
      'probe_documents',
      'Probe_search_documents',
      '1probe_search_documents',
      '_probe_search_documents',
      'probe-search_documents',
      'probe_search_documents_x',
    ])('%sは名前の規約に合わないため拒否する', (tableName) => {
      const table = snakeCase.table(tableName, {
        ...searchDocumentColumns(),
        name: searchTextColumn('name'),
      });

      expectDefinitionError(
        {
          documents: table,
          textColumns: [{ column: table.name, weight: 1 }],
          keywordsWeight: 1,
        },
        /テーブル名/,
      );
    });
  });

  describe('共通の列', () => {
    test.each(commonColumnEntries)(
      '共通の列%sが無いテーブルを拒否する',
      (missingName, missingKey) => {
        const columns = Object.fromEntries(
          Object.entries(searchDocumentColumns()).filter(
            ([key]) => key !== missingKey,
          ),
        );
        const table = snakeCase.table('lacking_search_documents', {
          ...columns,
          name: searchTextColumn('name'),
        });

        expectDefinitionError(
          {
            documents: table,
            textColumns: [{ column: table.name, weight: 1 }],
            keywordsWeight: 1,
          },
          new RegExp(`共通の列.*${missingName}`),
        );
      },
    );

    test('idが整数の主キーでないテーブルを拒否する', () => {
      const table = snakeCase.table('text_id_search_documents', {
        ...searchDocumentColumns(),
        id: text('id').primaryKey(),
        name: searchTextColumn('name'),
      });

      expectDefinitionError(
        {
          documents: table,
          textColumns: [{ column: table.name, weight: 1 }],
          keywordsWeight: 1,
        },
        /id.*整数の主キー/,
      );
    });

    test('idが主キーでないテーブルを拒否する', () => {
      const table = snakeCase.table('plain_id_search_documents', {
        ...searchDocumentColumns(),
        id: integer('id').notNull(),
        name: searchTextColumn('name'),
      });

      expectDefinitionError(
        {
          documents: table,
          textColumns: [{ column: table.name, weight: 1 }],
          keywordsWeight: 1,
        },
        /id.*整数の主キー/,
      );
    });
  });

  describe('元テキストの列', () => {
    test('元テキストの列が無い定義を拒否する', () => {
      expectDefinitionError({ ...validInput, textColumns: [] }, /1つ以上/);
    });

    test('他のテーブルの列を拒否する', () => {
      expectDefinitionError(
        {
          ...validInput,
          textColumns: [{ column: otherSearchDocuments.name, weight: 1 }],
        },
        /probe_search_documentsの列ではありません/,
      );
    });

    test('同じ列を2回指定した定義を拒否する', () => {
      expectDefinitionError(
        {
          ...validInput,
          textColumns: [
            { column: probeSearchDocuments.name, weight: 10 },
            { column: probeSearchDocuments.name, weight: 5 },
          ],
        },
        /name.*重複/,
      );
    });

    test.each([
      'keywords',
      'source_id',
      'keyword_status',
      'extraction_input_hash',
    ] as const)('共通の列%sを元テキストの列として拒否する', (name) => {
      expectDefinitionError(
        {
          ...validInput,
          textColumns: [{ column: columnNamed(name), weight: 1 }],
        },
        new RegExp(`${name}.*共通の列`),
      );
    });

    test.each(['Name', 'body-text', '1name', 'body text', '名前'])(
      '列名%sは英小文字で始まる英小文字・数字・_の名前でないため拒否する',
      (name) => {
        const table = snakeCase.table('odd_search_documents', {
          ...searchDocumentColumns(),
          odd: searchTextColumn(name),
        });

        expectDefinitionError(
          {
            documents: table,
            textColumns: [{ column: table.odd, weight: 1 }],
            keywordsWeight: 1,
          },
          /列名/,
        );
      },
    );

    test.each(['rank', 'rowid', 'reserved_search_documents_fts'])(
      '全文検索の索引で予約された列名%sを拒否する',
      (name) => {
        const table = snakeCase.table('reserved_search_documents', {
          ...searchDocumentColumns(),
          reserved: searchTextColumn(name),
        });

        expectDefinitionError(
          {
            documents: table,
            textColumns: [{ column: table.reserved, weight: 1 }],
            keywordsWeight: 1,
          },
          /全文検索の索引で予約/,
        );
      },
    );

    test.each([
      'order',
      'group',
      'index',
      'values',
      'default',
      'check',
      'references',
      'to',
      'add',
      'set',
      'limit',
      'key',
      'select',
      'from',
      'match',
      'replace',
      'without',
    ])(
      'SQLiteの予約語%sを、引用符無しでSQLに埋め込む列名として拒否する',
      (name) => {
        const table = snakeCase.table('keyword_search_documents', {
          ...searchDocumentColumns(),
          keyword: searchTextColumn(name),
        });

        expectDefinitionError(
          {
            documents: table,
            textColumns: [{ column: table.keyword, weight: 1 }],
            keywordsWeight: 1,
          },
          /SQLiteの予約語/,
        );
      },
    );

    test.each(['content', 'prefix', 'locale', 'oid', 'title', 'orders'])(
      'SQLiteの予約語でない列名%sを受け付ける',
      (name) => {
        const table = snakeCase.table('plain_search_documents', {
          ...searchDocumentColumns(),
          plain: searchTextColumn(name),
        });

        expect(
          defineSearchIndex({
            documents: table,
            textColumns: [{ column: table.plain, weight: 1 }],
            keywordsWeight: 1,
          }).textColumns,
        ).toEqual([{ name, weight: 1 }]);
      },
    );
  });

  describe('SQLITE_KEYWORDS', () => {
    test('SQLiteの公式の一覧の147語を、重複無しの英小文字で持つ', () => {
      expect(SQLITE_KEYWORDS).toHaveLength(147);
      expect(new Set(SQLITE_KEYWORDS).size).toBe(147);
      expect(
        SQLITE_KEYWORDS.every((keyword) => /^[a-z_]+$/.test(keyword)),
      ).toBe(true);
    });

    test('引用符無しの列名に使うと構文の誤りになる語を含む', () => {
      const db = new Database(':memory:');
      try {
        const failing = SQLITE_KEYWORDS.filter((keyword) => {
          try {
            db.run(`CREATE TABLE probe_${keyword} (${keyword} TEXT)`);
            return false;
          } catch {
            return true;
          }
        });

        for (const keyword of ['order', 'group', 'index', 'values']) {
          expect(failing).toContain(keyword);
        }
      } finally {
        db.close();
      }
    });
  });

  describe('重み', () => {
    test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      '元テキストの列の重み%pを拒否する',
      (weight) => {
        expectDefinitionError(
          {
            ...validInput,
            textColumns: [{ column: probeSearchDocuments.name, weight }],
          },
          /name.*重み/,
        );
      },
    );

    test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
      'キーワードの列の重み%pを拒否する',
      (keywordsWeight) => {
        expectDefinitionError(
          { ...validInput, keywordsWeight },
          /keywords.*重み/,
        );
      },
    );

    test('小数の重みを受け付ける', () => {
      expect(
        defineSearchIndex({ ...validInput, keywordsWeight: 0.5 })
          .keywordsWeight,
      ).toBe(0.5);
    });
  });

  describe('前方一致の長さ', () => {
    test.each([
      [[]],
      [[0]],
      [[5]],
      [[1.5]],
      [[3, 2]],
      [[2, 2]],
      [[Number.NaN]],
    ])('%pは1〜4の昇順の整数の並びでないため拒否する', (prefixLengths) => {
      expectDefinitionError({ ...validInput, prefixLengths }, /前方一致/);
    });
  });
});
