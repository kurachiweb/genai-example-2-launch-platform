import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { products } from '../product/products.ts';
import { productRatings } from './product-ratings.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(productRatings);

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

describe('product_ratings', () => {
  test('テーブル名はプロダクトの評価の複数形のスネークケースになる', () => {
    expect(config.name).toBe('product_ratings');
  });

  test('プロダクト・評価者・評価の値・無効化の日時の列と、論理削除を含む共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'product_id',
      'user_id',
      'score',
      'invalidated_at',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  });

  test('idはULIDを採番するテキストの主キーになる', () => {
    const id = columnOf('id');

    expect(id.getSQLType()).toBe('text');
    expect(id.primary).toBe(true);
    expect(id.defaultFn?.()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test.each(['product_id', 'user_id'])(
    '%sは単独では一意にならず既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('scoreは既定値を持たないNOT NULLの数値の整数になる', () => {
    const score = columnOf('score');

    expect(score.getSQLType()).toBe('integer');
    expect(score.columnType).toBe('SQLiteInteger');
    expect(score.notNull).toBe(true);
    expect(score.hasDefault).toBe(false);
  });

  test.each(['invalidated_at', 'deleted_at'])(
    '%sは印が無いことを表すNULLを許し、既定値を持たないUTCミリ秒の整数になる',
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

  test('プロダクトと評価者のIDがそれぞれのidを参照し、削除時の動作を指定しない', () => {
    const foreignKeys = config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        foreignTable: reference.foreignTable,
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: foreignKey.onDelete,
      };
    });

    expect(foreignKeys).toEqual([
      {
        columns: ['product_id'],
        foreignTable: products,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['user_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('プロダクトと評価者の組で1行に限る一意索引と、評価者の索引を持つ', () => {
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
        name: 'product_ratings_product_id_user_id_unique',
        columns: ['product_id', 'user_id'],
        unique: true,
        where: undefined,
      },
      {
        name: 'product_ratings_user_id_idx',
        columns: ['user_id'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('評価の値を1〜5に限るCHECK制約を、値を埋め込んだ条件で持つ', () => {
    const checks = config.checks.map((check) => {
      const query = dialect.sqlToQuery(check.value, 'indexes');
      return { name: check.name, sql: query.sql, params: query.params };
    });

    expect(checks).toEqual([
      {
        name: 'product_ratings_score_check',
        sql: '"score" in (1, 2, 3, 4, 5)',
        params: [],
      },
    ]);
  });
});
