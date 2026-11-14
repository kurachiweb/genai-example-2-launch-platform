import { describe, expect, test } from 'bun:test';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { notificationSenderSettings } from './notification-sender-settings.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(notificationSenderSettings);

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

describe('notification_sender_settings', () => {
  test('テーブル名は送信者情報の設定の複数形のスネークケースになる', () => {
    expect(config.name).toBe('notification_sender_settings');
  });

  test('鍵・3項目・版・最後に変更した管理者の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'setting_key',
      'business_name',
      'contact_email',
      'postal_address',
      'version',
      'updated_by_admin_id',
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

  test('setting_keyはNOT NULLのテキストで、既定値を持たない', () => {
    const settingKey = columnOf('setting_key');

    expect(settingKey.getSQLType()).toBe('text');
    expect(settingKey.notNull).toBe(true);
    expect(settingKey.hasDefault).toBe(false);
  });

  test.each(['business_name', 'contact_email', 'postal_address'])(
    '%sは未設定を表すNULLを許すテキストで、既定値を持たない',
    (name) => {
      const column = columnOf(name);

      expect(column.getSQLType()).toBe('text');
      expect(column.notNull).toBe(false);
      expect(column.hasDefault).toBe(false);
    },
  );

  test('versionは既定値0のNOT NULLの整数になる', () => {
    const version = columnOf('version');

    expect(version.getSQLType()).toBe('integer');
    expect(version.columnType).toBe('SQLiteInteger');
    expect(version.notNull).toBe(true);
    expect(version.default).toBe(0);
  });

  test('updated_by_admin_idは管理者が変更していないことを表すNULLを許すテキストで、既定値を持たない', () => {
    const updatedByAdminId = columnOf('updated_by_admin_id');

    expect(updatedByAdminId.getSQLType()).toBe('text');
    expect(updatedByAdminId.notNull).toBe(false);
    expect(updatedByAdminId.hasDefault).toBe(false);
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

  test('鍵ごとに1行にする一意索引だけを持つ', () => {
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
        name: 'notification_sender_settings_setting_key_unique',
        columns: ['setting_key'],
        unique: true,
        where: undefined,
      },
    ]);
  });

  test('版を0以上に限り、版0なら3項目をNULL・版1以上なら3項目をNOT NULLに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'notification_sender_settings_version_check',
        sql: '"version" >= 0',
      },
      {
        name: 'notification_sender_settings_values_by_version_check',
        sql: '("version" = 0 and "business_name" is null and "contact_email" is null and "postal_address" is null) or ("version" >= 1 and "business_name" is not null and "contact_email" is not null and "postal_address" is not null)',
      },
    ]);
  });

  test('管理者の物理削除で行が消えないよう、updated_by_admin_idを含めて外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});
