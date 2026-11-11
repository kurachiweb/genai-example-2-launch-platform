import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { KEYWORD_STATUSES } from '../_shared/search-documents.ts';
import { helpArticleSearchDocuments } from './help-article-search-documents.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(helpArticleSearchDocuments);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string | undefined =>
  (column as SQLiteColumn & { mode?: string }).mode;

describe('help_article_search_documents', () => {
  test('テーブル名はヘルプ記事の索引文書の名前<ドメイン>_search_documentsになる', () => {
    expect(config.name).toBe('help_article_search_documents');
  });

  test('索引文書の共通の列の後にタイトル・サブタイトルの元テキストの列だけを持ち、共通カラム・論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'source_id',
      'source_version',
      'keywords',
      'keyword_status',
      'extraction_input_hash',
      'status_changed_at',
      'title',
      'subtitle',
    ]);
  });

  test('idは全文検索の索引のrowidに使う整数の主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('integer');
    expect(id.primary).toBe(true);
    expect(id.defaultFn).toBeUndefined();
  });

  test('source_idは記事のIDを持つNOT NULLで一意なテキストになる', () => {
    const sourceId = columnOf('source_id');

    expect(sourceId.getSQLType()).toBe('text');
    expect(sourceId.notNull).toBe(true);
    expect(sourceId.isUnique).toBe(true);
  });

  test('keyword_statusはキーワードの状態に限り、既定値は更新待ちになる', () => {
    const keywordStatus = columnOf('keyword_status');

    expect(keywordStatus.enumValues).toEqual([...KEYWORD_STATUSES]);
    expect(keywordStatus.default).toBe('pending');
  });

  test('status_changed_atはUTCミリ秒のNOT NULLの整数になる', () => {
    const statusChangedAt = columnOf('status_changed_at');

    expect(statusChangedAt.getSQLType()).toBe('integer');
    expect(modeOf(statusChangedAt)).toBe('timestamp_ms');
    expect(statusChangedAt.notNull).toBe(true);
  });

  test.each(['title', 'subtitle'])(
    '元テキストの列%sは、NOT NULLで既定値が空文字列のテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.default).toBe('');
    },
  );

  test('外部キーを持たず、状態と状態を変えた日時の索引だけを持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(config.foreignKeys).toEqual([]);
    expect(indexes).toEqual([
      {
        name: 'help_article_search_documents_status_idx',
        columns: ['keyword_status', 'status_changed_at'],
        unique: false,
      },
    ]);
  });
});
