import { describe, expect, test } from 'bun:test';

import { getTableConfig, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { adminRecoveryCodes } from './admin-recovery-codes.ts';
import { admins } from './admins.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(adminRecoveryCodes);

const columnOf = (name: string): TableColumn => {
  const column = config.columns.find((candidate) => candidate.name === name);
  if (column === undefined) {
    throw new Error(`列${name}がテーブル定義にありません`);
  }
  return column;
};

const modeOf = (column: TableColumn): string =>
  (column as SQLiteColumn & { mode: string }).mode;

describe('admin_recovery_codes', () => {
  test('テーブル名は管理者のリカバリコードの複数形のスネークケースになる', () => {
    expect(config.name).toBe('admin_recovery_codes');
  });

  test('管理者・コードのハッシュの列と共通カラムだけを持つ', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'admin_id',
      'code_hash',
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

  test('admin_idは管理者のIDを持つNOT NULLのテキストで、単独では一意にならない', () => {
    const adminId = columnOf('admin_id');

    expect(adminId.getSQLType()).toBe('text');
    expect(adminId.notNull).toBe(true);
    expect(adminId.isUnique).toBe(false);
    expect(adminId.hasDefault).toBe(false);
  });

  test('code_hashは大文字小文字を区別する一意のNOT NULLのテキストになる', () => {
    const codeHash = columnOf('code_hash');

    expect(codeHash.getSQLType()).toBe('text');
    expect(codeHash.notNull).toBe(true);
    expect(codeHash.isUnique).toBe(true);
    expect(codeHash.hasDefault).toBe(false);
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

  test('管理者ごとの照会に、一意でない索引を持つ', () => {
    const indexes = config.indexes.map((index) => ({
      name: index.config.name,
      columns: index.config.columns.map(
        (column) => (column as SQLiteColumn).name,
      ),
      unique: index.config.unique,
    }));

    expect(indexes).toEqual([
      {
        name: 'admin_recovery_codes_admin_id_idx',
        columns: ['admin_id'],
        unique: false,
      },
    ]);
  });
});
