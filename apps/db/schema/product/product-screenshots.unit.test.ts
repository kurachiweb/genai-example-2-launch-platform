import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { productScreenshots } from './product-screenshots.ts';
import { products } from './products.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(productScreenshots);

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

describe('product_screenshots', () => {
  test('テーブル名はプロダクトのスクリーンショットの複数形のスネークケースになる', () => {
    expect(config.name).toBe('product_screenshots');
  });

  test('プロダクト・位置・ファイルの列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'product_id',
      'position',
      'file_id',
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

  test.each(['product_id', 'file_id'])(
    '%sは単独では一意にならないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('positionはNOT NULLの整数で、既定値を持たない', () => {
    const position = columnOf('position');

    expect(position.getSQLType()).toBe('integer');
    expect(position.notNull).toBe(true);
    expect(position.hasDefault).toBe(false);
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

  test('product_idだけがproductsのidを参照し、削除時の動作を指定せず、ファイルのIDは外部キーを持たない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'product_id',
    ]);
    expect(reference?.foreignTable).toBe(products);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('プロダクトと位置の組を一意にする索引だけを持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
      where: index.config.where,
    }));

    expect(indexes).toEqual([
      {
        name: 'product_screenshots_product_id_position_unique',
        columns: ['product_id', 'position'],
        unique: true,
        where: undefined,
      },
    ]);
  });

  test('positionを0から19までに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'product_screenshots_position_check',
        sql: `"position" between 0 and 19`,
      },
    ]);
  });
});
