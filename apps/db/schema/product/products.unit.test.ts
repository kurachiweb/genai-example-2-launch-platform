import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { productCategories } from './product-categories.ts';
import { products } from './products.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(products);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('products', () => {
  test('テーブル名はプロダクトの複数形のスネークケースになる', () => {
    expect(config.name).toBe('products');
  });

  test('投稿者・カテゴリ・ハンドル・入力項目・最新のローンチ日・版・非公開化の列と共通カラム・論理削除の列だけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'category_id',
      'handle',
      'name',
      'tagline',
      'website_url',
      'description_markdown',
      'logo_file_id',
      'latest_launch_date',
      'version',
      'hidden_at',
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

  test('handleは大文字小文字を区別せず、論理削除した行を含む全行で一意のNOT NULLの列になる', () => {
    const handle = columnOf('handle');

    expect(handle.getSQLType()).toBe('text collate nocase');
    expect(handle.notNull).toBe(true);
    expect(handle.isUnique).toBe(true);
    expect(handle.hasDefault).toBe(false);
  });

  test.each([
    'user_id',
    'category_id',
    'name',
    'tagline',
    'website_url',
    'description_markdown',
    'logo_file_id',
    'latest_launch_date',
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

  test('versionは数値の整数でNOT NULLになり、既定値は0になる', () => {
    const version = columnOf('version');

    expect(version.getSQLType()).toBe('integer');
    expect(version.columnType).toBe('SQLiteInteger');
    expect(version.notNull).toBe(true);
    expect(version.default).toBe(0);
  });

  test.each(['hidden_at', 'deleted_at'])(
    '%sは非公開化・論理削除の日時をUTCミリ秒で持ち、該当しないことを表すNULLを許す',
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

  test('user_idはusersを、category_idはproduct_categoriesを参照し、削除時の動作を指定せず、ロゴのIDは外部キーを持たない', () => {
    const references = config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return {
        columns: reference.columns.map((column) => column.name),
        foreignTable: reference.foreignTable,
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: foreignKey.onDelete,
      };
    });

    expect(references).toEqual([
      {
        columns: ['user_id'],
        foreignTable: users,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
      {
        columns: ['category_id'],
        foreignTable: productCategories,
        foreignColumns: ['id'],
        onDelete: undefined,
      },
    ]);
  });

  test('投稿者ごとの最新のローンチ日の順の一覧・カテゴリ・論理削除の日時の索引を持つ', () => {
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
        name: 'products_user_id_latest_launch_date_id_idx',
        columns: ['user_id', 'latest_launch_date', 'id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'products_category_id_idx',
        columns: ['category_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'products_deleted_at_idx',
        columns: ['deleted_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('CHECK制約を持たない', () => {
    expect(config.checks).toEqual([]);
  });
});
