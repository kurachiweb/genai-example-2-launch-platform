import { describe, expect, test } from 'bun:test';

import { getTableConfig } from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { userPreviousHandles } from './user-previous-handles.ts';

const config = getTableConfig(userPreviousHandles);

const columnOf = (name: string) => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

describe('user_previous_handles', () => {
  test('テーブル名は利用者の旧ハンドルの複数形のスネークケースになる', () => {
    expect(config.name).toBe('user_previous_handles');
  });

  test('旧ハンドルの共通の列だけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'handle',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  });

  test('user_idは利用者1人に1行に限る一意のNOT NULLのテキストになる', () => {
    const userId = columnOf('user_id');

    expect(userId.getSQLType()).toBe('text');
    expect(userId.notNull).toBe(true);
    expect(userId.isUnique).toBe(true);
  });

  test('handleは大文字小文字を区別せずに全利用者の旧ハンドルの中で一意になる', () => {
    const handle = columnOf('handle');

    expect(handle.getSQLType()).toBe('text collate nocase');
    expect(handle.notNull).toBe(true);
    expect(handle.isUnique).toBe(true);
  });

  test('user_idはusersのidを参照し、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'user_id',
    ]);
    expect(reference?.foreignTable).toBe(users);
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
