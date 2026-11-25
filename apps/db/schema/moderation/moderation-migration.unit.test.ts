import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const ACTIONS_MIGRATION_SUFFIX = '_ugc_moderation';

const STATISTICS_MIGRATION_SUFFIX = '_ugc_moderation_statistics';

const migrationSql = (suffix: string): string => {
  const name = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .find((candidate) => candidate.endsWith(suffix));
  if (name === undefined) {
    throw new Error(`${suffix}で終わるマイグレーションがありません`);
  }
  return readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
};

const statementsOf = (suffix: string): string[] =>
  migrationSql(suffix)
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const createdTablesOf = (suffix: string): (string | undefined)[] =>
  statementsOf(suffix)
    .filter((statement) => statement.startsWith('CREATE TABLE'))
    .map((statement) => /^CREATE TABLE `([^`]+)`/.exec(statement)?.[1]);

const createTableStatement = (suffix: string, table: string): string => {
  const statement = statementsOf(suffix).find((part) =>
    part.startsWith(`CREATE TABLE \`${table}\` (`),
  );
  if (statement === undefined) {
    throw new Error(`${table}を作る文がありません`);
  }
  return statement;
};

const createModerationActionsTable = (): string =>
  createTableStatement(ACTIONS_MIGRATION_SUFFIX, 'moderation_actions');

const createWeeklyStatisticsTable = (): string =>
  createTableStatement(
    STATISTICS_MIGRATION_SUFFIX,
    'moderation_weekly_statistics',
  );

describe('ugc-moderationの措置の記録のマイグレーション', () => {
  test('moderation_actionsを作る文と索引の文だけを含み、週ごとの統計と既存のテーブルを作らない', () => {
    expect(createdTablesOf(ACTIONS_MIGRATION_SUFFIX)).toEqual([
      'moderation_actions',
    ]);
    expect(createModerationActionsTable()).toContain('`id` text PRIMARY KEY');
    expect(migrationSql(ACTIONS_MIGRATION_SUFFIX)).not.toMatch(
      /DROP TABLE|ALTER TABLE/,
    );
  });

  test.each([
    [
      'action',
      `('user.suspend', 'user.unsuspend', 'user.administrative-withdraw', 'product.hide', 'product.unhide', 'comment.hide', 'comment.unhide', 'rating.invalidate', 'rating.revalidate', 'image.approve', 'image.quarantine', 'image.release', 'image.delete')`,
    ],
    ['target_kind', `('user', 'product', 'comment', 'rating', 'image')`],
    ['notice_status', `('none', 'pending', 'requested', 'skipped')`],
  ])('%sのCHECK制約は許される値を埋め込んで作る', (column, values) => {
    expect(createModerationActionsTable()).toContain(
      `CONSTRAINT "moderation_actions_${column}_check" CHECK("${column}" in ${values})`,
    );
  });

  test('バインド変数の`?`を残さない', () => {
    expect(migrationSql(ACTIONS_MIGRATION_SUFFIX)).not.toContain('?');
  });

  test.each([
    'CREATE INDEX `moderation_actions_target_kind_target_id_occurred_at_idx` ON `moderation_actions` (`target_kind`,`target_id`,`occurred_at`);',
    'CREATE INDEX `moderation_actions_notice_status_occurred_at_idx` ON `moderation_actions` (`notice_status`,`occurred_at`);',
    'CREATE INDEX `moderation_actions_subject_user_id_idx` ON `moderation_actions` (`subject_user_id`);',
    'CREATE INDEX `moderation_actions_product_id_idx` ON `moderation_actions` (`product_id`);',
    'CREATE INDEX `moderation_actions_occurred_at_idx` ON `moderation_actions` (`occurred_at`);',
  ])('索引の文を含む: %s', (statement) => {
    expect(migrationSql(ACTIONS_MIGRATION_SUFFIX)).toContain(statement);
  });

  test('他のテーブルを参照しない', () => {
    expect(migrationSql(ACTIONS_MIGRATION_SUFFIX)).not.toMatch(
      /FOREIGN KEY|REFERENCES/,
    );
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(migrationSql(ACTIONS_MIGRATION_SUFFIX)).not.toContain('INSERT');
  });
});

describe('ugc-moderationの週ごとの統計のマイグレーション', () => {
  test('moderation_weekly_statisticsを作る文と一意索引の文だけを含み、措置の記録と既存のテーブルを作らない', () => {
    expect(createdTablesOf(STATISTICS_MIGRATION_SUFFIX)).toEqual([
      'moderation_weekly_statistics',
    ]);
    expect(createWeeklyStatisticsTable()).toContain('`id` text PRIMARY KEY');
    expect(migrationSql(STATISTICS_MIGRATION_SUFFIX)).not.toMatch(
      /DROP TABLE|ALTER TABLE/,
    );
  });

  test.each([
    ['finalized', '"finalized" in (0, 1)'],
    ['users_total', '"users_total" >= 0'],
    ['products_total', '"products_total" >= 0'],
    ['qualifier_matches', '"qualifier_matches" >= 0'],
    ['upvotes', '"upvotes" >= 0'],
  ])('%sのCHECK制約を作る', (column, condition) => {
    expect(createWeeklyStatisticsTable()).toContain(
      `CONSTRAINT "moderation_weekly_statistics_${column}_check" CHECK(${condition})`,
    );
  });

  test('収益の符号を限るCHECK制約を作らない', () => {
    expect(createWeeklyStatisticsTable()).not.toContain('net_revenue_check');
  });

  test('週の開始日の一意索引の文を含み、他の索引を作らない', () => {
    const indexes = statementsOf(STATISTICS_MIGRATION_SUFFIX).filter(
      (statement) => /^CREATE (UNIQUE )?INDEX/.test(statement),
    );

    expect(indexes).toEqual([
      'CREATE UNIQUE INDEX `moderation_weekly_statistics_week_start_unique` ON `moderation_weekly_statistics` (`week_start`);',
    ]);
  });

  test('バインド変数の`?`を残さない', () => {
    expect(migrationSql(STATISTICS_MIGRATION_SUFFIX)).not.toContain('?');
  });

  test('他のテーブルを参照しない', () => {
    expect(migrationSql(STATISTICS_MIGRATION_SUFFIX)).not.toMatch(
      /FOREIGN KEY|REFERENCES/,
    );
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(migrationSql(STATISTICS_MIGRATION_SUFFIX)).not.toContain('INSERT');
  });
});
