import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from '../identity/users.ts';
import { apiKeys } from './api-keys.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(apiKeys);

const dialect = new SQLiteDialect();

const READ_SCOPE_COLUMNS = [
  'scope_products',
  'scope_launches',
  'scope_upvotes',
  'scope_comments',
  'scope_ratings',
] as const;

const WRITE_SCOPE_COLUMNS = [
  'scope_profile',
  'scope_product_descriptions',
] as const;

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('api_keys', () => {
  test('テーブル名はAPIキーの複数形のスネークケースになる', () => {
    expect(config.name).toBe('api_keys');
  });

  test('利用者・名前・照合用のハッシュ・7つの機能の権限スコープの列と共通カラムだけを持ち、平文と論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'name',
      'key_hash',
      ...READ_SCOPE_COLUMNS,
      ...WRITE_SCOPE_COLUMNS,
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

  test.each(['user_id', 'name', 'key_hash'])(
    '%sは既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
    },
  );

  test.each(READ_SCOPE_COLUMNS)(
    '読み取りだけの機能の%sは無効と読み取りだけを取る、既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
      expect(column.enumValues).toEqual(['none', 'read']);
    },
  );

  test.each(WRITE_SCOPE_COLUMNS)(
    '書き込める機能の%sは無効・読み取り・読み書きを取る、既定値を持たないNOT NULLのテキストになる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.hasDefault).toBe(false);
      expect(column.enumValues).toEqual(['none', 'read', 'read_write']);
    },
  );

  test.each(['created_at', 'updated_at'])(
    '名前と権限スコープを編集するため、%sは共通カラムのUTCミリ秒のNOT NULLの列になる',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(true);
      expect(column.defaultFn?.()).toBeInstanceOf(Date);
    },
  );

  test('user_idだけがusersのidを参照し、退会の同期の波及処理で先に消すため削除時の動作を指定しない', () => {
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

  test('照合用のハッシュの一意索引と、利用者ごとの一覧と削除のための(user_id, created_at, id)の索引を持つ', () => {
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
        name: 'api_keys_key_hash_unique',
        columns: ['key_hash'],
        unique: true,
        where: undefined,
      },
      {
        name: 'api_keys_user_id_created_at_id_idx',
        columns: ['user_id', 'created_at', 'id'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('7つの機能の権限スコープを機能ごとに許される値に限るCHECK制約を、値を埋め込んで持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      ...READ_SCOPE_COLUMNS.map((column) => ({
        name: `api_keys_${column}_check`,
        sql: `"${column}" in ('none', 'read')`,
      })),
      ...WRITE_SCOPE_COLUMNS.map((column) => ({
        name: `api_keys_${column}_check`,
        sql: `"${column}" in ('none', 'read', 'read_write')`,
      })),
    ]);
  });
});
