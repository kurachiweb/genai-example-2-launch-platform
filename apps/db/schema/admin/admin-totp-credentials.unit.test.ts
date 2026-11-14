import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { adminTotpCredentials } from './admin-totp-credentials.ts';
import { admins } from './admins.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(adminTotpCredentials);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('admin_totp_credentials', () => {
  test('テーブル名は管理者のTOTPの資格情報の複数形のスネークケースになる', () => {
    expect(config.name).toBe('admin_totp_credentials');
  });

  test('管理者・暗号化した秘密鍵・有効化・時間窓・再設定の保留の列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'admin_id',
      'sealed_secret',
      'enabled_at',
      'last_used_step',
      'pending_sealed_secret',
      'pending_expires_at',
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

  test('admin_idは管理者ごとに1行に限る一意のNOT NULLのテキストになる', () => {
    const adminId = columnOf('admin_id');

    expect(adminId.getSQLType()).toBe('text');
    expect(adminId.notNull).toBe(true);
    expect(adminId.isUnique).toBe(true);
    expect(adminId.hasDefault).toBe(false);
  });

  test.each(['sealed_secret', 'pending_sealed_secret'])(
    '%sは一意でないテキストで、該当する秘密鍵が無いことを表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.isUnique).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

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

  test('admin_idはadminsのidを参照し、削除時の動作を指定しない', () => {
    expect(config.foreignKeys).toHaveLength(1);
    const [foreignKey] = config.foreignKeys;
    const reference = foreignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'admin_id',
    ]);
    expect(reference?.foreignTable).toBe(admins);
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
        name: 'admin_totp_credentials_pending_expires_at_idx',
        columns: ['pending_expires_at'],
        unique: false,
      },
    ]);
  });
});
