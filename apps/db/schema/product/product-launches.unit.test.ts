import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { productLaunches } from './product-launches.ts';
import { products } from './products.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(productLaunches);

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

describe('product_launches', () => {
  test('テーブル名はプロダクトのローンチの複数形のスネークケースになる', () => {
    expect(config.name).toBe('product_launches');
  });

  test('プロダクト・ローンチ日・予選の結果・確定・取消の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'product_id',
      'launch_date',
      'outcome',
      'decided_at',
      'cancelled_at',
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

  test.each(['product_id', 'launch_date'])(
    '%sは単独では一意にならず既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('outcomeは勝利・敗北だけを取り、未確定を表すNULLを許すテキストになる', () => {
    const outcome = columnOf('outcome');

    expect(outcome.getSQLType()).toBe('text');
    expect(outcome.notNull).toBe(false);
    expect(outcome.enumValues).toEqual(['won', 'lost']);
    expect(outcome.hasDefault).toBe(false);
  });

  test.each(['decided_at', 'cancelled_at'])(
    '%sは確定・取消の日時をUTCミリ秒で持ち、該当しないことを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

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

  test('product_idはproductsのidを参照し、削除時の動作を指定しない', () => {
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

  test('未確定かつ取消でないローンチをプロダクトに1つに限る部分一意索引と、日付順の照会の索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
      where:
        index.config.where === undefined
          ? undefined
          : dialect.sqlToQuery(index.config.where, 'indexes').sql,
    }));

    expect(indexes).toEqual([
      {
        name: 'product_launches_product_id_open_unique',
        columns: ['product_id'],
        unique: true,
        where: `("outcome" is null and "cancelled_at" is null)`,
      },
      {
        name: 'product_launches_launch_date_id_idx',
        columns: ['launch_date', 'id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'product_launches_product_id_launch_date_idx',
        columns: ['product_id', 'launch_date'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('outcomeを勝利・敗北だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'product_launches_outcome_check',
        sql: `"outcome" in ('won', 'lost')`,
      },
    ]);
  });
});
