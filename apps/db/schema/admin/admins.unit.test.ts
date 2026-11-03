import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { admins } from './admins.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(admins);

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

describe('admins', () => {
  test('テーブル名は管理者の複数形のスネークケースになる', () => {
    expect(config.name).toBe('admins');
  });

  test('アカウント・プロフィール・ロール・状態・招待と有効化の日時の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'email',
      'password_hash',
      'nickname',
      'title',
      'avatar_file_id',
      'role',
      'status',
      'invitation_expires_at',
      'activated_at',
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

  test('emailは大文字小文字を区別せず全管理者で一意のNOT NULLの列になる', () => {
    const email = columnOf('email');

    expect(email.getSQLType()).toBe('text collate nocase');
    expect(email.notNull).toBe(true);
    expect(email.isUnique).toBe(true);
    expect(email.hasDefault).toBe(false);
  });

  test.each(['password_hash', 'nickname', 'title', 'avatar_file_id'])(
    '%sは値を限らない一意でないテキストで、招待の完了前や未設定を表すNULLを許す',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.isUnique).toBe(false);
      expect(column.enumValues).toBeUndefined();
      expect(column.hasDefault).toBe(false);
    },
  );

  test('roleは閲覧のみ・モデレーター・最上位管理者だけを取るNOT NULLのテキストで、既定値を持たない', () => {
    const role = columnOf('role');

    expect(role.getSQLType()).toBe('text');
    expect(role.notNull).toBe(true);
    expect(role.enumValues).toEqual(['viewer', 'moderator', 'super_admin']);
    expect(role.hasDefault).toBe(false);
  });

  test('statusは招待中・有効だけを取るNOT NULLのテキストで、既定値は招待中になる', () => {
    const status = columnOf('status');

    expect(status.getSQLType()).toBe('text');
    expect(status.notNull).toBe(true);
    expect(status.enumValues).toEqual(['invited', 'active']);
    expect(status.default).toBe('invited');
  });

  test.each(['invitation_expires_at', 'activated_at'])(
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

  test('ロールと状態の組み合わせの照会に、一意でない索引を持つ', () => {
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
        name: 'admins_role_status_idx',
        columns: ['role', 'status'],
        unique: false,
        where: undefined,
      },
    ]);
  });

  test('roleとstatusを取り得る値だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'admins_role_check',
        sql: `"role" in ('viewer', 'moderator', 'super_admin')`,
      },
      {
        name: 'admins_status_check',
        sql: `"status" in ('invited', 'active')`,
      },
    ]);
  });

  test('プロフィール画像の参照を含め、他のテーブルへの外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});
