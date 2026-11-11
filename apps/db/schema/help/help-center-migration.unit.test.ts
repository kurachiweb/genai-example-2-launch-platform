import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { decodeTime } from 'ulid';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_help_center';

const SEED_MIGRATION_SUFFIX = '_help_center_seed';

const FTS_MIGRATION_SUFFIX = '_help_center_fts';

const OTHER_CATEGORY_ID = '01JC0000000000000000000001';

const OTHER_CATEGORY_CREATED_AT = 1730871820288;

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

describe('help-centerのテーブルのマイグレーション', () => {
  test.each([
    ['help_categories', 'name'],
    ['help_articles', 'handle'],
    ['help_article_previous_handles', 'handle'],
  ])(
    '%sの%sは大文字小文字を区別しない一意の列として作られる',
    (tableName, columnName) => {
      expect(createTableOf(tableName)).toContain(
        `\`${columnName}\` text collate nocase NOT NULL UNIQUE`,
      );
    },
  );

  test('旧ハンドルは記事1件に1行に限る', () => {
    expect(createTableOf('help_article_previous_handles')).toContain(
      '`article_id` text NOT NULL UNIQUE',
    );
  });

  test.each([
    [
      'help_categories',
      'CONSTRAINT "help_categories_system_default_check" CHECK("system_default" in (0, 1))',
    ],
    [
      'help_categories',
      'CONSTRAINT "help_categories_sort_order_check" CHECK("sort_order" >= 1)',
    ],
    [
      'help_articles',
      'CONSTRAINT "help_articles_pinned_check" CHECK("pinned" in (0, 1))',
    ],
    [
      'help_articles',
      `CONSTRAINT "help_articles_status_check" CHECK("status" in ('draft', 'published'))`,
    ],
    [
      'help_articles',
      'CONSTRAINT "help_articles_sort_order_check" CHECK("sort_order" >= 1)',
    ],
    [
      'help_articles',
      'CONSTRAINT "help_articles_revision_check" CHECK("revision" >= 1)',
    ],
  ])('%sは値を限るCHECKを含む: %s', (tableName, constraint) => {
    expect(createTableOf(tableName)).toContain(constraint);
  });

  test.each([
    'CREATE INDEX `help_categories_sort_order_idx` ON `help_categories` (`sort_order`);',
    'CREATE INDEX `help_articles_category_id_sort_order_idx` ON `help_articles` (`category_id`,`sort_order`);',
    'CREATE INDEX `help_articles_status_category_id_idx` ON `help_articles` (`status`,`category_id`);',
    'CREATE INDEX `help_article_search_documents_status_idx` ON `help_article_search_documents` (`keyword_status`,`status_changed_at`);',
  ])('索引を含む: %s', (statement) => {
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).toContain(statement);
  });

  test('索引文書のテーブルを連番の主キーと一意のsource_idで作る', () => {
    const statement = createTableOf('help_article_search_documents');

    expect(statement).toContain('`id` integer PRIMARY KEY');
    expect(statement).toContain('`source_id` text NOT NULL UNIQUE');
    expect(statement).toContain("`title` text DEFAULT '' NOT NULL");
    expect(statement).toContain("`subtitle` text DEFAULT '' NOT NULL");
  });

  test('外部キーはON DELETEを指定せず、作成者のIDはadminsを参照しない', () => {
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).not.toMatch(/ON DELETE/i);
    expect(createTableOf('help_articles')).toContain(
      'FOREIGN KEY (`category_id`) REFERENCES `help_categories`(`id`)',
    );
    expect(createTableOf('help_articles')).not.toContain('REFERENCES `admins`');
    expect(createTableOf('help_article_previous_handles')).toContain(
      'FOREIGN KEY (`article_id`) REFERENCES `help_articles`(`id`)',
    );
  });

  test('テーブルを作るマイグレーションは全文検索の索引と初期データを含まない', () => {
    const sql = migrationSqlOf(TABLE_MIGRATION_SUFFIX);

    expect(sql).not.toContain('VIRTUAL TABLE');
    expect(sql).not.toContain('TRIGGER');
    expect(sql).not.toContain('INSERT');
  });
});

describe('help-centerの初期データと全文検索の索引のマイグレーション', () => {
  test('テーブルの作成・初期データ・全文検索の索引の順に続けて適用される', () => {
    const names = migrationDirectoryNames();
    const tableAt = names.indexOf(
      migrationNameEndingWith(TABLE_MIGRATION_SUFFIX),
    );

    expect(names.indexOf(migrationNameEndingWith(SEED_MIGRATION_SUFFIX))).toBe(
      tableAt + 1,
    );
    expect(names.indexOf(migrationNameEndingWith(FTS_MIGRATION_SUFFIX))).toBe(
      tableAt + 2,
    );
  });

  test('全列を明示して標準カテゴリ「その他」を並び順1で入れ、同じ名前の行があれば何もしない', () => {
    expect(migrationSqlOf(SEED_MIGRATION_SUFFIX)).toBe(
      [
        'INSERT INTO `help_categories` (`id`, `name`, `system_default`, `sort_order`, `created_at`, `updated_at`) VALUES',
        `\t('${OTHER_CATEGORY_ID}', 'その他', 1, 1, ${String(OTHER_CATEGORY_CREATED_AT)}, ${String(OTHER_CATEGORY_CREATED_AT)})`,
        'ON CONFLICT (`name`) DO NOTHING;',
        '',
      ].join('\n'),
    );
  });

  test('作成日時はIDのULIDの時刻部が表す時刻にする', () => {
    expect(decodeTime(OTHER_CATEGORY_ID)).toBe(OTHER_CATEGORY_CREATED_AT);
  });
});
