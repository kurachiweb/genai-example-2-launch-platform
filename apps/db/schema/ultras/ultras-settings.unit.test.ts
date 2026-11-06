import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  getTableConfig,
  SQLiteDialect,
  type SQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { decodeTime } from 'ulid';

import { ultrasSettings } from './ultras-settings.ts';

type TableColumn = ReturnType<typeof getTableConfig>['columns'][number];

const config = getTableConfig(ultrasSettings);

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

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_ultras_subscription';

const SEED_MIGRATION_SUFFIX = '_ultras_subscription_seed';

const PROMOTION_SETTING_ID = '01M6Q2FD000000000000000001';

const SEED_INSERT_PATTERN =
  /^INSERT INTO `ultras_settings` \(`id`, `setting_key`, `enabled`, `version`, `updated_by_admin_id`, `created_at`, `updated_at`\) VALUES\n\t\('([0-9A-HJKMNP-TV-Z]{26})', '([a-z_]+)', (\d), (\d+), (NULL), (\d+), (\d+)\)\nON CONFLICT \(`setting_key`\) DO NOTHING;\n$/;

const migrationDirectoryNames = (): string[] =>
  readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const migrationNameEndingWith = (suffix: string): string => {
  const found = migrationDirectoryNames().find((name) => name.endsWith(suffix));
  if (found === undefined) {
    throw new Error(`${suffix}で終わるマイグレーションがありません`);
  }
  return found;
};

const seedMigrationSql = (): string =>
  readFileSync(
    join(
      MIGRATIONS_DIR,
      migrationNameEndingWith(SEED_MIGRATION_SUFFIX),
      'migration.sql',
    ),
    'utf8',
  );

describe('ultras_settings', () => {
  test('テーブル名はUltrasの設定の複数形のスネークケースになる', () => {
    expect(config.name).toBe('ultras_settings');
  });

  test('鍵・有効の印・版・最後に変更した管理者の列と共通カラムだけを持ち、論理削除の列を持たない', () => {
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'setting_key',
      'enabled',
      'version',
      'updated_by_admin_id',
      'created_at',
      'updated_at',
    ]);
  });

  test('版の照合に使うversionを持ち、state_tokenの列を持たない', () => {
    const names = config.columns.map((column) => column.name);

    expect(names).toContain('version');
    expect(names).not.toContain('state_token');
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

  test('enabledは真偽を0・1で持つNOT NULLの整数で、既定はオフになる', () => {
    const enabled = columnOf('enabled');

    expect(enabled.getSQLType()).toBe('integer');
    expect(modeOf(enabled)).toBe('boolean');
    expect(enabled.notNull).toBe(true);
    expect(enabled.default).toBe(false);
  });

  test('versionは既定値0のNOT NULLの整数になる', () => {
    const version = columnOf('version');

    expect(version.getSQLType()).toBe('integer');
    expect(version.columnType).toBe('SQLiteInteger');
    expect(version.notNull).toBe(true);
    expect(version.default).toBe(0);
  });

  test('updated_by_admin_idは値を限らないテキストで、管理者が変更していないことを表すNULLを許す', () => {
    const updatedByAdminId = columnOf('updated_by_admin_id');

    expect(updatedByAdminId.getSQLType()).toBe('text');
    expect(updatedByAdminId.notNull).toBe(false);
    expect(updatedByAdminId.enumValues).toBeUndefined();
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
        name: 'ultras_settings_setting_key_unique',
        columns: ['setting_key'],
        unique: true,
        where: undefined,
      },
    ]);
  });

  test('enabledを0・1だけに限るCHECK制約を持つ', () => {
    const checks = config.checks.map((check) => ({
      name: check.name,
      sql: dialect.sqlToQuery(check.value, 'indexes').sql,
    }));

    expect(checks).toEqual([
      {
        name: 'ultras_settings_enabled_check',
        sql: '"enabled" in (0, 1)',
      },
    ]);
  });

  test('管理者の物理削除で行が消えないよう、updated_by_admin_idを含めて外部キーを持たない', () => {
    expect(config.foreignKeys).toEqual([]);
  });
});

describe('機能フラグの初期データのマイグレーション', () => {
  test('テーブルを作るマイグレーションの直後に適用される別のカスタムマイグレーションとして置く', () => {
    const names = migrationDirectoryNames();
    const tableIndex = names.indexOf(
      migrationNameEndingWith(TABLE_MIGRATION_SUFFIX),
    );

    expect(names[tableIndex + 1]).toBe(
      migrationNameEndingWith(SEED_MIGRATION_SUFFIX),
    );
  });

  test('鍵ultras_promotionの行をオフ・版0・管理者なしで、鍵の重複を無視して挿入する', () => {
    const match = SEED_INSERT_PATTERN.exec(seedMigrationSql());

    expect(match).not.toBeNull();
    const [, id, settingKey, enabled, version, updatedByAdminId] = match ?? [];
    expect({ id, settingKey, enabled, version, updatedByAdminId }).toEqual({
      id: PROMOTION_SETTING_ID,
      settingKey: 'ultras_promotion',
      enabled: '0',
      version: '0',
      updatedByAdminId: 'NULL',
    });
  });

  test('固定のULIDの時刻部とcreated_at・updated_atが同じエポックミリ秒になる', () => {
    const match = SEED_INSERT_PATTERN.exec(seedMigrationSql());

    const [, id = '', , , , , createdAt, updatedAt] = match ?? [];
    expect(createdAt).toBe(String(decodeTime(id)));
    expect(updatedAt).toBe(String(decodeTime(id)));
  });
});
