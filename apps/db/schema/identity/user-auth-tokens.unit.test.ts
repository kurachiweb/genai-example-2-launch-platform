import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { userAuthTokens } from './user-auth-tokens.ts';
import { users } from './users.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(userAuthTokens);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('user_auth_tokens', () => {
  test('テーブル名は認証系トークンの複数形のスネークケースになる', () => {
    expect(config.name).toBe('user_auth_tokens');
  });

  test('利用者・用途・ハッシュ・期限・変更先の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'purpose',
      'token_hash',
      'expires_at',
      'new_email',
      'pending_password_hash',
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

  test('user_idは利用者のIDを持つNOT NULLのテキストで、単独では一意にならない', () => {
    const userId = columnOf('user_id');

    expect(userId.getSQLType()).toBe('text');
    expect(userId.notNull).toBe(true);
    expect(userId.isUnique).toBe(false);
    expect(userId.hasDefault).toBe(false);
  });

  test('purposeは4種の用途だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const purpose = columnOf('purpose');

    expect(purpose.getSQLType()).toBe('text');
    expect(purpose.notNull).toBe(true);
    expect(purpose.isUnique).toBe(false);
    expect(purpose.enumValues).toEqual([
      'email_verification',
      'email_change',
      'password_reset',
      'password_change',
    ]);
    expect(purpose.hasDefault).toBe(false);
  });

  test('token_hashは大文字小文字を区別する一意のNOT NULLのテキストになる', () => {
    const tokenHash = columnOf('token_hash');

    expect(tokenHash.getSQLType()).toBe('text');
    expect(tokenHash.notNull).toBe(true);
    expect(tokenHash.isUnique).toBe(true);
    expect(tokenHash.hasDefault).toBe(false);
  });

  test('expires_atはUTCミリ秒の整数でNOT NULLになり、既定値を持たない', () => {
    const expiresAt = columnOf('expires_at');

    expect(expiresAt.getSQLType()).toBe('integer');
    expect(modeOf(expiresAt)).toBe('timestamp_ms');
    expect(expiresAt.notNull).toBe(true);
    expect(expiresAt.hasDefault).toBe(false);
  });

  test('new_emailは大文字小文字を区別しない列で、メールアドレスの変更以外の用途を表すNULLを許す', () => {
    const newEmail = columnOf('new_email');

    expect(newEmail.getSQLType()).toBe('text collate nocase');
    expect(newEmail.notNull).toBe(false);
    expect(newEmail.isUnique).toBe(false);
    expect(newEmail.hasDefault).toBe(false);
  });

  test('pending_password_hashはテキストで、保留中のパスワードが無いことを表すNULLを許す', () => {
    const pending = columnOf('pending_password_hash');

    expect(pending.getSQLType()).toBe('text');
    expect(pending.notNull).toBe(false);
    expect(pending.hasDefault).toBe(false);
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

  test('利用者と用途の組・期限の照会に、一意でない索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'user_auth_tokens_user_id_purpose_idx',
        columns: ['user_id', 'purpose'],
        unique: false,
      },
      {
        name: 'user_auth_tokens_expires_at_idx',
        columns: ['expires_at'],
        unique: false,
      },
    ]);
  });

  test('purposeを4種の用途だけに限るCHECK制約を持つ', () => {
    const dialect = new SQLiteDialect();
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'user_auth_tokens_purpose_check',
        sql: `"purpose" in ('email_verification', 'email_change', 'password_reset', 'password_change')`,
      },
    ]);
  });
});
