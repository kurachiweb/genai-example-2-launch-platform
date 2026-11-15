import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { inquiryCategories } from './inquiry-categories.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(inquiryCategories);

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

describe('inquiry_categories', () => {
  test('テーブル名は問い合わせカテゴリの複数形のスネークケースになる', () => {
    expect(config.name).toBe('inquiry_categories');
  });

  test('名前・標準カテゴリの印と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'name',
      'system_default',
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

  test('名前の一意制約の他に索引を持たない', () => {
    expect(config.indexes).toEqual([]);
  });

  test('system_defaultを0・1だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'inquiry_categories_system_default_check',
        sql: `"system_default" in (0, 1)`,
      },
    ]);
  });

  test('他のテーブルへの外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});
