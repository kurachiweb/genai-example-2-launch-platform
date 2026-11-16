import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { productLaunches } from '../product/product-launches.ts';
import { products } from '../product/products.ts';
import { launchComments } from './launch-comments.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(launchComments);

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

describe('launch_comments', () => {
  test('テーブル名はローンチのコメントの複数形のスネークケースになる', () => {
    expect(config.name).toBe('launch_comments');
  });

  test('プロダクト・ローンチ・親・ルート・階層・投稿者・本文・状態の印の列と、論理削除を含む共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'product_id',
      'launch_id',
      'parent_id',
      'root_id',
      'depth',
      'author_user_id',
      'body',
      'edited_at',
      'hidden_at',
      'anonymized_at',
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

  test.each(['product_id', 'launch_id', 'root_id', 'body'])(
    '%sは単独では一意にならず既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(['parent_id', 'author_user_id'])(
    '%sはトップレベルや匿名化でNULLを許し、既定値を持たないテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('depthは既定値を持たないNOT NULLの数値の整数になる', () => {
    const depth = columnOf('depth');

    expect(depth.getSQLType()).toBe('integer');
    expect(depth.columnType).toBe('SQLiteInteger');
    expect(depth.notNull).toBe(true);
    expect(depth.hasDefault).toBe(false);
  });

  test.each(['edited_at', 'hidden_at', 'anonymized_at', 'deleted_at'])(
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

  test('プロダクト・ローンチ・親のコメント・投稿者のIDがそれぞれのidを参照し、ルートは参照せず、削除時の動作を指定しない', () => {
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
        columns: ['launch_id'],
        foreignTable: productLaunches,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['parent_id'],
        foreignTable: launchComments,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['author_user_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('トップレベルのページ・返信のまとめ読み・投稿者・プロダクト・削除の日時の索引を持ち、一意索引を持たない', () => {
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
        name: 'launch_comments_launch_id_depth_created_at_id_idx',
        columns: ['launch_id', 'depth', 'created_at', 'id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'launch_comments_root_id_created_at_id_idx',
        columns: ['root_id', 'created_at', 'id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'launch_comments_author_user_id_idx',
        columns: ['author_user_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'launch_comments_product_id_idx',
        columns: ['product_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'launch_comments_deleted_at_idx',
        columns: ['deleted_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('階層を1〜3に限るCHECK制約を、値を埋め込んだ条件で持つ', () => {
    const checks = config.checks.map((check) => {
      const query = dialect.sqlToQuery(check.value, 'indexes');
      return { name: check.name, sql: query.sql, params: query.params };
    });

    expect(checks).toEqual([
      {
        name: 'launch_comments_depth_check',
        sql: '"depth" between 1 and 3',
        params: [],
      },
    ]);
  });
});
