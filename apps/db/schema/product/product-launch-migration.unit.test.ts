import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { decodeTime } from 'ulid';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_product_launch';

const SEED_MIGRATION_SUFFIX = '_product_launch_seed';

const OTHER_CATEGORY_ID = '01JD0000000000000000000000';

const OTHER_CATEGORY_CREATED_AT = 1731945562112;

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

const migrationSqlOf = (suffix: string): string =>
  readFileSync(
    join(MIGRATIONS_DIR, migrationNameEndingWith(suffix), 'migration.sql'),
    'utf8',
  );

const createTableOf = (tableName: string): string => {
  const statement = migrationSqlOf(TABLE_MIGRATION_SUFFIX)
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`CREATE TABLE \`${tableName}\` (`));
  if (statement === undefined) {
    throw new Error(`${tableName}を作る文がありません`);
  }
  return statement;
};

describe('product-launchのテーブルのマイグレーション', () => {
  test.each([
    ['product_categories', 'name'],
    ['product_categories', 'handle'],
    ['products', 'handle'],
    ['product_previous_handles', 'handle'],
  ])(
    '%sの%sは大文字小文字を区別しない一意の列として作られる',
    (tableName, columnName) => {
      expect(createTableOf(tableName)).toContain(
        `\`${columnName}\` text collate nocase NOT NULL UNIQUE`,
      );
    },
  );

  test.each([
    [
      'product_categories',
      'CONSTRAINT "product_categories_system_default_check" CHECK("system_default" in (0, 1))',
    ],
    [
      'product_screenshots',
      'CONSTRAINT "product_screenshots_position_check" CHECK("position" between 0 and 19)',
    ],
    [
      'product_launches',
      `CONSTRAINT "product_launches_outcome_check" CHECK("outcome" in ('won', 'lost'))`,
    ],
    [
      'product_lifecycle_events',
      `CONSTRAINT "product_lifecycle_events_type_check" CHECK("type" in ('deleted', 'hidden', 'unhidden', 'purge_due'))`,
    ],
    [
      'product_lifecycle_events',
      `CONSTRAINT "product_lifecycle_events_status_check" CHECK("status" in ('pending', 'completed'))`,
    ],
  ])('%sは値を限るCHECKを含む: %s', (tableName, constraint) => {
    expect(createTableOf(tableName)).toContain(constraint);
  });

  test('未確定かつ取消でないローンチをプロダクトに1つに限る部分一意索引を含む', () => {
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).toContain(
      'CREATE UNIQUE INDEX `product_launches_product_id_open_unique` ON `product_launches` (`product_id`) WHERE ("product_launches"."outcome" is null and "product_launches"."cancelled_at" is null);',
    );
  });

  test('物理削除の開始をプロダクトに1つに限る部分一意索引を含む', () => {
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).toContain(
      `CREATE UNIQUE INDEX \`product_lifecycle_events_product_id_purge_due_unique\` ON \`product_lifecycle_events\` (\`product_id\`) WHERE "product_lifecycle_events"."type" = 'purge_due';`,
    );
  });

  test('外部キーはON DELETEを指定せず、画像のIDはmedia_filesを参照しない', () => {
    const sql = migrationSqlOf(TABLE_MIGRATION_SUFFIX);

    expect(sql).not.toMatch(/ON DELETE/i);
    expect(sql).not.toContain('REFERENCES `media_files`');
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).not.toContain('INSERT');
  });
});

describe('product-launchの初期データのマイグレーション', () => {
  test('テーブルの作成の直後に適用される', () => {
    const names = migrationDirectoryNames();

    expect(names.indexOf(migrationNameEndingWith(SEED_MIGRATION_SUFFIX))).toBe(
      names.indexOf(migrationNameEndingWith(TABLE_MIGRATION_SUFFIX)) + 1,
    );
  });

  test('全列を明示して標準カテゴリ「その他」を入れ、同じ名前の行があれば何もしない', () => {
    expect(migrationSqlOf(SEED_MIGRATION_SUFFIX)).toBe(
      [
        'INSERT INTO `product_categories` (`id`, `name`, `handle`, `system_default`, `created_at`, `updated_at`) VALUES',
        `\t('${OTHER_CATEGORY_ID}', 'その他', 'other', 1, ${String(OTHER_CATEGORY_CREATED_AT)}, ${String(OTHER_CATEGORY_CREATED_AT)})`,
        'ON CONFLICT (`name`) DO NOTHING;',
        '',
      ].join('\n'),
    );
  });

  test('作成日時はIDのULIDの時刻部が表す時刻にする', () => {
    expect(decodeTime(OTHER_CATEGORY_ID)).toBe(OTHER_CATEGORY_CREATED_AT);
  });
});
