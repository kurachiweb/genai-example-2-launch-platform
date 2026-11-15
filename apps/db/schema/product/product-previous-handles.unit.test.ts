import { describe, expect, test } from 'bun:test';

import { getTableConfig } from 'drizzle-orm/sqlite-core';

import { productPreviousHandles } from './product-previous-handles.ts';
import { products } from './products.ts';

const config = getTableConfig(productPreviousHandles);

const columnOf = (name: string) => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

describe('product_previous_handles', () => {
  test('テーブル名はプロダクトの旧ハンドルの複数形のスネークケースになる', () => {
    expect(config.name).toBe('product_previous_handles');
  });

  test('旧ハンドルの共通の列だけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'product_id',
      'handle',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  });

  test('product_idはプロダクト1つに1行に限る一意のNOT NULLのテキストになる', () => {
    const productId = columnOf('product_id');

    expect(productId.getSQLType()).toBe('text');
    expect(productId.notNull).toBe(true);
    expect(productId.isUnique).toBe(true);
  });

  test('handleは大文字小文字を区別せずに全プロダクトの旧ハンドルの中で一意になる', () => {
    const handle = columnOf('handle');

    expect(handle.getSQLType()).toBe('text collate nocase');
    expect(handle.notNull).toBe(true);
    expect(handle.isUnique).toBe(true);
  });

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

  test('一意の列以外に索引とCHECK制約を持たない', () => {
    expect(config.indexes).toEqual([]);
    expect(config.checks).toEqual([]);
  });
});
