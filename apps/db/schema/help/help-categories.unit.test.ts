import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { helpCategories } from './help-categories.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(helpCategories);

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

describe('help_categories', () => {
  test('テーブル名はヘルプ記事カテゴリの複数形のスネークケースになる', () => {
    expect(config.name).toBe('help_categories');
  });

  test('名前・標準カテゴリの印・並び順と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'name',
      'system_default',
      'sort_order',
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

  test('nameは大文字小文字を区別せず全行で一意のNOT NULLの列で、既定値を持たない', () => {
    const name = columnOf('name');

    expect(name.getSQLType()).toBe('text collate nocase');
    expect(name.notNull).toBe(true);
    expect(name.isUnique).toBe(true);
    expect(name.hasDefault).toBe(false);
  });

  test('system_defaultは真偽を0・1で持つNOT NULLの整数で、既定は標準カテゴリでない', () => {
    const systemDefault = columnOf('system_default');

    expect(systemDefault.getSQLType()).toBe('integer');
    expect(modeOf(systemDefault)).toBe('boolean');
    expect(systemDefault.notNull).toBe(true);
    expect(systemDefault.default).toBe(false);
    expect(systemDefault.isUnique).toBe(false);
  });

  test('sort_orderは一意にしないNOT NULLの整数で、既定値を持たない', () => {
    const sortOrder = columnOf('sort_order');

    expect(sortOrder.getSQLType()).toBe('integer');
    expect(sortOrder.notNull).toBe(true);
    expect(sortOrder.isUnique).toBe(false);
    expect(sortOrder.hasDefault).toBe(false);
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

  test('並び順の照会のための、一意でない並び順の索引だけを持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'help_categories_sort_order_idx',
        columns: ['sort_order'],
        unique: false,
      },
    ]);
  });

  test('system_defaultを0・1に、sort_orderを1以上に限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'help_categories_system_default_check',
        sql: `"system_default" in (0, 1)`,
      },
      {
        name: 'help_categories_sort_order_check',
        sql: `"sort_order" >= 1`,
      },
    ]);
  });

  test('他のテーブルへの外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});
