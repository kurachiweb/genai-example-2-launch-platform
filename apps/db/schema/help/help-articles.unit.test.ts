import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { helpArticles, publishedHelpArticle } from './help-articles.ts';
import { helpCategories } from './help-categories.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(helpArticles);

const dialect = new SQLiteDialect();

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('help_articles', () => {
  test('テーブル名はヘルプ記事の複数形のスネークケースになる', () => {
    expect(config.name).toBe('help_articles');
  });

  test('ハンドル・入力項目・カテゴリ・ピン留め・ステータス・並び順・作成者・版の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'handle',
      'title',
      'subtitle',
      'body_markdown',
      'category_id',
      'pinned',
      'status',
      'sort_order',
      'created_by_admin_id',
      'revision',
      'created_at',
      'updated_at',
    ]);
  });

  test('idはULIDを採番するテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.defaultFn?.()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test('handleは大文字小文字を区別せず、下書きを含む全行で一意のNOT NULLの列になる', () => {
    const handle = columnOf('handle');

    expect(handle.getSQLType()).toBe('text collate nocase');
    expect(handle.notNull).toBe(true);
    expect(handle.isUnique).toBe(true);
    expect(handle.hasDefault).toBe(false);
  });

  test.each([
    'title',
    'subtitle',
    'body_markdown',
    'category_id',
    'created_by_admin_id',
  ])(
    '%sは単独では一意にならず既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('pinnedは真偽を0・1で持つNOT NULLの整数で、既定はピン留めしない', () => {
    const pinned = columnOf('pinned');

    expect(pinned.getSQLType()).toBe('integer');
    expect(modeOf(pinned)).toBe('boolean');
    expect(pinned.notNull).toBe(true);
    expect(pinned.default).toBe(false);
  });

  test('statusは下書き・公開に限るNOT NULLのテキストで、既定値を持たない', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.enumValues).toEqual(['draft', 'published']);
    expect(status.notNull).toBe(true);
    expect(status.hasDefault).toBe(false);
  });

  test('sort_orderは一意にしないNOT NULLの整数で、既定値を持たない', () => {
    const sortOrder = columnOf('sort_order');

    expect(sortOrder.getSQLType()).toBe('integer');
    expect(sortOrder.notNull).toBe(true);
    expect(sortOrder.isUnique).toBe(false);
    expect(sortOrder.hasDefault).toBe(false);
  });

  test('revisionはNOT NULLの整数で、作成時の版1を既定にする', () => {
    const revision = columnOf('revision');

    expect(revision.getSQLType()).toBe('integer');
    expect(revision.notNull).toBe(true);
    expect(revision.default).toBe(1);
  });

  test.each(['created_at', 'updated_at'])(
    '%sは共通カラムのUTCミリ秒のNOT NULLの列になる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.defaultFn?.()).toBeInstanceOf(Date);
    },
  );

  test('外部キーはcategory_idからhelp_categoriesのidへの1つだけで、削除時の動作を指定せず、作成者は参照しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'category_id',
    ]);
    expect(reference?.foreignTable).toBe(helpCategories);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('カテゴリ内の並び順の索引と、公開の記事をカテゴリごとに読む索引を持ち、どちらも一意にしない', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'help_articles_category_id_sort_order_idx',
        columns: ['category_id', 'sort_order'],
        unique: false,
      },
      {
        name: 'help_articles_status_category_id_idx',
        columns: ['status', 'category_id'],
        unique: false,
      },
    ]);
  });

  test('pinnedを0・1に、statusを下書き・公開に、sort_orderとrevisionを1以上に限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'help_articles_pinned_check',
        sql: `"pinned" in (0, 1)`,
      },
      {
        name: 'help_articles_status_check',
        sql: `"status" in ('draft', 'published')`,
      },
      {
        name: 'help_articles_sort_order_check',
        sql: `"sort_order" >= 1`,
      },
      {
        name: 'help_articles_revision_check',
        sql: `"revision" >= 1`,
      },
    ]);
  });
});

describe('publishedHelpArticle', () => {
  test('ステータスが公開の記事に絞り込む条件になる', () => {
    const query = dialect.sqlToQuery(publishedHelpArticle);

    expect(query.sql).toBe('"help_articles"."status" = ?');
    expect(query.params).toEqual(['published']);
  });
});
