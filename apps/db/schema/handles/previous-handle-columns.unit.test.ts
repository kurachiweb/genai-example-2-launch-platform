import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  snakeCase,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { ulidPrimaryKey } from '../_shared/columns.ts';
import { previousHandleColumns } from './previous-handle-columns.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const owners = snakeCase.table('probe_owners', {
  id: ulidPrimaryKey(),
});

const probePreviousHandles = snakeCase.table(
  'probe_previous_handles',
  previousHandleColumns({
    ownerColumnName: 'owner_id',
    references: () => owners.id,
  }),
);

const config = getTableConfig(probePreviousHandles);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('previousHandleColumns', () => {
  test('主キー・保有者のID・ハンドルと共通カラム・論理削除の列を、この順で持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'owner_id',
      'handle',
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

  test('保有者のIDの列名は呼び出し側が指定し、一意のNOT NULLのテキストになる', () => {
    const ownerId = columnOf('owner_id');

    expect(ownerId.getSQLType()).toBe('text');
    expect(ownerId.notNull).toBe(true);
    expect(ownerId.isUnique).toBe(true);
    expect(ownerId.hasDefault).toBe(false);
  });

  test('保有者のIDは指定された列を参照し、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'owner_id',
    ]);
    expect(reference?.foreignTable).toBe(owners);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
    ]);
    expect(foreignKey?.onDelete).toBeUndefined();
  });

  test('handleは大文字小文字を区別しない一意のNOT NULLのテキストになる', () => {
    const handle = columnOf('handle');

    expect(handle.getSQLType()).toBe('text collate nocase');
    expect(handle.notNull).toBe(true);
    expect(handle.isUnique).toBe(true);
    expect(handle.hasDefault).toBe(false);
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

  test('deleted_atは論理削除のUTCミリ秒のNULLを許す列になる', () => {
    const deletedAt = columnOf('deleted_at');

    expect(deletedAt.getSQLType()).toBe('integer');
    expect(modeOf(deletedAt)).toBe('timestamp_ms');
    expect(deletedAt.notNull).toBe(false);
    expect(deletedAt.hasDefault).toBe(false);
  });
});
