import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { users } from './users.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(users);

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

describe('users', () => {
  test('テーブル名は利用者の複数形のスネークケースになる', () => {
    expect(config.name).toBe('users');
  });

  test('アカウント・状態・確認・判定・同意・版の列と共通カラムだけを持ち、IPアドレスの列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'pseudonymous_id',
      'email',
      'password_hash',
      'nickname',
      'handle',
      'status',
      'suspended_at',
      'email_verified_at',
      'disposable_email_status',
      'disposable_email_checked_at',
      'terms_agreed_at',
      'lifecycle_version',
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

  test('pseudonymous_idは全行で一意のNOT NULLのテキストで、既定値を持たない', () => {
    const pseudonymousId = columnOf('pseudonymous_id');

    expect(pseudonymousId.getSQLType()).toBe('text');
    expect(pseudonymousId.notNull).toBe(true);
    expect(pseudonymousId.isUnique).toBe(true);
    expect(pseudonymousId.hasDefault).toBe(false);
  });

  test('handleは大文字小文字を区別せず全行で一意のNOT NULLの列になる', () => {
    const handle = columnOf('handle');

    expect(handle.getSQLType()).toBe('text collate nocase');
    expect(handle.notNull).toBe(true);
    expect(handle.isUnique).toBe(true);
    expect(handle.hasDefault).toBe(false);
  });

  test('emailは大文字小文字を区別しないNOT NULLの列で、列自体には一意制約を持たない', () => {
    const email = columnOf('email');

    expect(email.getSQLType()).toBe('text collate nocase');
    expect(email.notNull).toBe(true);
    expect(email.isUnique).toBe(false);
    expect(email.hasDefault).toBe(false);
  });

  test.each(['password_hash', 'nickname'])(
    '%sは値を限らない一意でないNOT NULLのテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(true);
      expect(column.isUnique).toBe(false);
      expect(column.enumValues).toBeUndefined();
      expect(column.hasDefault).toBe(false);
    },
  );

  test('statusは有効・停止中だけを取るNOT NULLのテキストで、既定値は有効になる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(['active', 'suspended']);
    expect(status.default).toBe('active');
  });

  test('disposable_email_statusは判定結果の3値だけを取るテキストで、確認前を表すNULLを許す', () => {
    const disposable = columnOf('disposable_email_status');

    expect(disposable.getSQLType()).toBe('text');
    expect(disposable.notNull).toBe(false);
    expect(disposable.enumValues).toEqual([
      'disposable',
      'regular',
      'undetermined',
    ]);
    expect(disposable.hasDefault).toBe(false);
  });

  test.each([
    'suspended_at',
    'email_verified_at',
    'disposable_email_checked_at',
    'deleted_at',
  ])(
    '%sはUTCミリ秒の整数で、未到達を表すNULLを許し、既定値と更新時の値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
      expect(column.onUpdateFn).toBeUndefined();
    },
  );

  test('terms_agreed_atはUTCミリ秒の整数でNOT NULLになり、既定値を持たない', () => {
    const termsAgreedAt = columnOf('terms_agreed_at');

    expect(termsAgreedAt.getSQLType()).toBe('integer');
    expect(modeOf(termsAgreedAt)).toBe('timestamp_ms');
    expect(termsAgreedAt.notNull).toBe(true);
    expect(termsAgreedAt.hasDefault).toBe(false);
  });

  test('lifecycle_versionは数値の整数でNOT NULLになり、既定値は0になる', () => {
    const version = columnOf('lifecycle_version');

    expect(version.getSQLType()).toBe('integer');
    expect(version.columnType).toBe('SQLiteInteger');
    expect(version.notNull).toBe(true);
    expect(version.default).toBe(0);
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

  test('メールアドレスは未退会ユーザーの中でだけ一意で、論理削除・状態・使い捨て判定の照会に索引を持つ', () => {
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
        name: 'users_email_not_deleted_unique',
        columns: ['email'],
        unique: true,
        where: '("deleted_at" is null)',
      },
      {
        name: 'users_deleted_at_idx',
        columns: ['deleted_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'users_status_deleted_at_idx',
        columns: ['status', 'deleted_at'],
        unique: false,
        where: undefined,
      },
      {
        name: 'users_disposable_email_status_checked_at_idx',
        columns: ['disposable_email_status', 'disposable_email_checked_at'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('statusを有効・停止中だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'users_status_check',
        sql: `"status" in ('active', 'suspended')`,
      },
    ]);
  });

  test('他のテーブルへの外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});
