import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { userProfiles } from './user-profiles.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(userProfiles);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('user_profiles', () => {
  test('テーブル名は利用者のプロフィールの複数形のスネークケースになる', () => {
    expect(config.name).toBe('user_profiles');
  });

  test('利用者・ヘッドライン・自己紹介・画像のIDの列と、論理削除を除く共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'headline',
      'bio_markdown',
      'avatar_file_id',
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

  test('user_idは利用者1人に1行に限る一意のNOT NULLのテキストになる', () => {
    const userId = columnOf('user_id');

    expect(userId.getSQLType()).toBe('text');
    expect(userId.notNull).toBe(true);
    expect(userId.isUnique).toBe(true);
    expect(userId.hasDefault).toBe(false);
  });

  test.each(['headline', 'bio_markdown', 'avatar_file_id'])(
    '%sは未入力を表すNULLを許すテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
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

  test('外部キーはuser_idからusersのidへの1つだけで、画像のIDには外部キーが無く、削除時の動作を指定しない', () => {
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
