import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { decodeTime } from 'ulid';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_content_reporting';

const SEED_MIGRATION_SUFFIX = '_content_reporting_seed';

const INFRINGEMENT_CATEGORY_ID = '01JE0000000000000000000001';

const OTHER_CATEGORY_ID = '01JE0000000000000000000002';

const migrationDirectoryNames = (): string[] =>
  readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const migrationNameEndingWith = (suffix: string): string => {
  const found = migrationDirectoryNames().filter((name) =>
    name.endsWith(suffix),
  );
  const [name] = found;
  if (found.length !== 1 || name === undefined) {
    throw new Error(
      `${suffix}で終わるマイグレーションを1つだけ見つけられません(${String(found.length)}件)`,
    );
  }
  return name;
};

const migrationSqlOf = (suffix: string): string =>
  readFileSync(
    join(MIGRATIONS_DIR, migrationNameEndingWith(suffix), 'migration.sql'),
    'utf8',
  );

const statementsOf = (suffix: string): string[] =>
  migrationSqlOf(suffix)
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const createTableOf = (tableName: string): string => {
  const statement = statementsOf(TABLE_MIGRATION_SUFFIX).find((part) =>
    part.startsWith(`CREATE TABLE \`${tableName}\` (`),
  );
  if (statement === undefined) {
    throw new Error(`${tableName}を作る文がありません`);
  }
  return statement;
};

describe('content-reportingのテーブルのマイグレーション', () => {
  test('通報カテゴリ・案件・通報の3テーブルだけを作り、既存のテーブルを変えない', () => {
    const created = statementsOf(TABLE_MIGRATION_SUFFIX)
      .filter((statement) => statement.startsWith('CREATE TABLE'))
      .map((statement) => /^CREATE TABLE `([^`]+)`/.exec(statement)?.[1]);

    expect(created.toSorted()).toEqual([
      'report_cases',
      'report_categories',
      'reports',
    ]);
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).not.toMatch(
      /DROP TABLE|ALTER TABLE/,
    );
  });

  test('カテゴリ名は大文字小文字を区別しない一意の列として作られる', () => {
    expect(createTableOf('report_categories')).toContain(
      '`name` text collate nocase NOT NULL UNIQUE',
    );
  });

  test.each([
    [
      'report_categories',
      'CONSTRAINT "report_categories_system_default_check" CHECK("system_default" in (0, 1))',
    ],
    [
      'report_cases',
      `CONSTRAINT "report_cases_target_kind_check" CHECK("target_kind" in ('user', 'product', 'comment'))`,
    ],
    [
      'report_cases',
      `CONSTRAINT "report_cases_status_check" CHECK("status" in ('open', 'in_progress', 'resolved', 'rejected'))`,
    ],
    [
      'report_cases',
      `CONSTRAINT "report_cases_resolution_check" CHECK("resolution" in ('product.hide', 'comment.hide', 'user.suspend', 'none'))`,
    ],
    [
      'report_cases',
      `CONSTRAINT "report_cases_poster_notice_status_check" CHECK("poster_notice_status" in ('none', 'pending', 'requested', 'skipped'))`,
    ],
    [
      'report_cases',
      `CONSTRAINT "report_cases_closed_at_check" CHECK(("status" in ('resolved', 'rejected')) = ("closed_at" is not null))`,
    ],
    [
      'report_cases',
      `CONSTRAINT "report_cases_target_detached_at_check" CHECK(("target_id" is null) = ("target_detached_at" is not null))`,
    ],
    [
      'report_cases',
      `CONSTRAINT "report_cases_resolution_action_id_check" CHECK(("resolution_action_id" is null or ("status" = 'resolved' and "resolution" in ('product.hide', 'comment.hide', 'user.suspend'))))`,
    ],
    [
      'reports',
      `CONSTRAINT "reports_outcome_notice_status_check" CHECK("outcome_notice_status" in ('none', 'pending', 'requested', 'skipped'))`,
    ],
    [
      'reports',
      'CONSTRAINT "reports_contact_email_check" CHECK(not ("reporter_user_id" is not null and "contact_email" is not null))',
    ],
  ])('%sは値と整合を限るCHECKを含む: %s', (tableName, constraint) => {
    expect(createTableOf(tableName)).toContain(constraint);
  });

  test('対象ごとの未完了の案件を1つに限る部分一意索引を含み、索引のカスタムマイグレーションを要さない', () => {
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).toContain(
      'CREATE UNIQUE INDEX `report_cases_target_kind_target_id_open_unique` ON `report_cases` (`target_kind`,`target_id`) WHERE "report_cases"."closed_at" is null;',
    );
  });

  test.each([
    'CREATE INDEX `report_cases_last_reported_at_id_idx` ON `report_cases` (`last_reported_at`,`id`);',
    'CREATE INDEX `report_cases_status_last_reported_at_idx` ON `report_cases` (`status`,`last_reported_at`);',
    'CREATE INDEX `report_cases_target_owner_user_id_idx` ON `report_cases` (`target_owner_user_id`);',
    'CREATE INDEX `report_cases_product_id_idx` ON `report_cases` (`product_id`);',
    'CREATE INDEX `report_cases_closed_at_idx` ON `report_cases` (`closed_at`);',
    'CREATE INDEX `report_cases_target_detached_at_idx` ON `report_cases` (`target_detached_at`);',
    'CREATE INDEX `reports_case_id_reported_at_idx` ON `reports` (`case_id`,`reported_at`);',
    'CREATE INDEX `reports_reporter_user_id_idx` ON `reports` (`reporter_user_id`);',
    'CREATE INDEX `reports_category_id_idx` ON `reports` (`category_id`);',
    'CREATE INDEX `reports_outcome_notice_status_case_id_idx` ON `reports` (`outcome_notice_status`,`case_id`);',
  ])('索引の文を含む: %s', (statement) => {
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).toContain(statement);
  });

  test('通報だけが案件・利用者・カテゴリを参照し、削除時の動作を指定せず、案件は他のテーブルを参照しない', () => {
    const reportsTable = createTableOf('reports');

    expect(reportsTable).toContain(
      'FOREIGN KEY (`case_id`) REFERENCES `report_cases`(`id`)',
    );
    expect(reportsTable).toContain(
      'FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`)',
    );
    expect(reportsTable).toContain(
      'FOREIGN KEY (`category_id`) REFERENCES `report_categories`(`id`)',
    );
    expect(createTableOf('report_cases')).not.toMatch(/FOREIGN KEY|REFERENCES/);
    expect(createTableOf('report_categories')).not.toMatch(
      /FOREIGN KEY|REFERENCES/,
    );
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).not.toMatch(/ON DELETE/i);
  });

  test('バインド変数の`?`を残さない', () => {
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).not.toContain('?');
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(migrationSqlOf(TABLE_MIGRATION_SUFFIX)).not.toContain('INSERT');
  });
});

describe('content-reportingの初期データのマイグレーション', () => {
  test('テーブルの作成の直後に適用される', () => {
    const names = migrationDirectoryNames();

    expect(names.indexOf(migrationNameEndingWith(SEED_MIGRATION_SUFFIX))).toBe(
      names.indexOf(migrationNameEndingWith(TABLE_MIGRATION_SUFFIX)) + 1,
    );
  });

  test('標準カテゴリ「権利侵害」「その他」を、固定のIDとIDの時刻部の日時で、全ての列を明示して名前の衝突を無視して入れる', () => {
    const infringementAt = decodeTime(INFRINGEMENT_CATEGORY_ID);
    const otherAt = decodeTime(OTHER_CATEGORY_ID);

    expect(statementsOf(SEED_MIGRATION_SUFFIX)).toEqual([
      [
        'INSERT INTO `report_categories` (`id`, `name`, `system_default`, `created_at`, `updated_at`) VALUES',
        `\t('${INFRINGEMENT_CATEGORY_ID}', '権利侵害', 1, ${String(infringementAt)}, ${String(infringementAt)}),`,
        `\t('${OTHER_CATEGORY_ID}', 'その他', 1, ${String(otherAt)}, ${String(otherAt)})`,
        'ON CONFLICT (`name`) DO NOTHING;',
      ].join('\n'),
    ]);
  });
});
