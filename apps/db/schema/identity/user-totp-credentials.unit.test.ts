import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { userTotpCredentials } from './user-totp-credentials.ts';
import { users } from './users.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(userTotpCredentials);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('user_totp_credentials', () => {
  test('テーブル名はTOTPの資格情報の複数形のスネークケースになる', () => {
    expect(config.name).toBe('user_totp_credentials');
  });

  test('利用者・暗号化した秘密鍵・有効化・保留・時間窓の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
      'sealed_secret',
      'enabled_at',
      'pending_expires_at',
      'last_used_step',
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

  test('user_idは利用者ごとに1行に限る一意のNOT NULLのテキストになる', () => {
    const userId = columnOf('user_id');

    expect(userId.getSQLType()).toBe('text');
    expect(userId.notNull).toBe(true);
    expect(userId.isUnique).toBe(true);
    expect(userId.hasDefault).toBe(false);
  });

  test('sealed_secretは一意でないNOT NULLのテキストで、既定値を持たない', () => {
    const sealedSecret = columnOf('sealed_secret');

    expect(sealedSecret.getSQLType()).toBe('text');
    expect(sealedSecret.notNull).toBe(true);
    expect(sealedSecret.isUnique).toBe(false);
    expect(sealedSecret.hasDefault).toBe(false);
  });

  test.each(['enabled_at', 'pending_expires_at'])(
    '%sはUTCミリ秒の整数で、該当しない状態を表すNULLを許し、既定値と更新時の値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('integer');
      expect(modeOf(column)).toBe('timestamp_ms');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
      expect(column.onUpdateFn).toBeUndefined();
    },
  );

  test('last_used_stepは数値の整数で、未使用を表すNULLを許す', () => {
    const lastUsedStep = columnOf('last_used_step');

    expect(lastUsedStep.getSQLType()).toBe('integer');
    expect(lastUsedStep.columnType).toBe('SQLiteInteger');
    expect(lastUsedStep.notNull).toBe(false);
    expect(lastUsedStep.hasDefault).toBe(false);
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

  test('保留の期限の照会に、一意でない索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'user_totp_credentials_pending_expires_at_idx',
        columns: ['pending_expires_at'],
        unique: false,
      },
    ]);
  });
});
