import { describe, expect, test } from 'bun:test';

import { getTableConfig } from 'drizzle-orm/sqlite-core';

import { helpArticlePreviousHandles } from './help-article-previous-handles.ts';
import { helpArticles } from './help-articles.ts';

const config = getTableConfig(helpArticlePreviousHandles);

const columnOf = (name: string) => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

describe('help_article_previous_handles', () => {
  test('テーブル名はヘルプ記事の旧ハンドルの複数形のスネークケースになる', () => {
    expect(config.name).toBe('help_article_previous_handles');
  });

  test('旧ハンドルの共通の列だけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'article_id',
      'handle',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  });

  test('article_idは記事1件に1行に限る一意のNOT NULLのテキストになる', () => {
    const articleId = columnOf('article_id');

    expect(articleId.getSQLType()).toBe('text');
    expect(articleId.notNull).toBe(true);
    expect(articleId.isUnique).toBe(true);
  });

  test('handleは大文字小文字を区別せずに全記事の旧ハンドルの中で一意になる', () => {
    const handle = columnOf('handle');

    expect(handle.getSQLType()).toBe('text collate nocase');
    expect(handle.notNull).toBe(true);
    expect(handle.isUnique).toBe(true);
  });

  test('article_idはhelp_articlesのidを参照し、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'article_id',
    ]);
    expect(reference?.foreignTable).toBe(helpArticles);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('一意の列以外に索引とCHECK制約を持たない', () => {
    expect(config.indexes).toEqual([]);
    expect(config.checks).toEqual([]);
  });
});
