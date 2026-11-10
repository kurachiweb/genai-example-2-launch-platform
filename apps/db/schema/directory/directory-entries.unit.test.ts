import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { products } from '../product/products.ts';
import { directoryEntries } from './directory-entries.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(directoryEntries);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('directory_entries', () => {
  test('テーブル名は勝利したプロダクトの記録の複数形のスネークケースになる', () => {
    expect(config.name).toBe('directory_entries');
  });

  test('プロダクト・投稿者・最初の勝利の日時の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'product_id',
      'owner_user_id',
      'first_won_at',
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

  test('product_idはプロダクトごとに1件に限る一意のNOT NULLのテキストになる', () => {
    const productId = columnOf('product_id');

    expect(productId.getSQLType()).toBe('text');
    expect(productId.notNull).toBe(true);
    expect(productId.isUnique).toBe(true);
    expect(productId.hasDefault).toBe(false);
  });

  test('owner_user_idは一意でないNOT NULLのテキストになる', () => {
    const ownerUserId = columnOf('owner_user_id');

    expect(ownerUserId.getSQLType()).toBe('text');
    expect(ownerUserId.notNull).toBe(true);
    expect(ownerUserId.isUnique).toBe(false);
    expect(ownerUserId.hasDefault).toBe(false);
  });

  test('first_won_atはUTCミリ秒のNOT NULLの整数で、既定値を持たない', () => {
    const firstWonAt = columnOf('first_won_at');

    expect(firstWonAt.getSQLType()).toBe('integer');
    expect(modeOf(firstWonAt)).toBe('timestamp_ms');
    expect(firstWonAt.notNull).toBe(true);
    expect(firstWonAt.hasDefault).toBe(false);
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

  test('外部キーはproduct_idからproductsのidへの1つだけで、削除時の動作を指定せず、投稿者は参照しない', () => {
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

  test('投稿者ごとの照会と削除のための、一意でない索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'directory_entries_owner_user_id_idx',
        columns: ['owner_user_id'],
        unique: false,
      },
    ]);
  });
});
