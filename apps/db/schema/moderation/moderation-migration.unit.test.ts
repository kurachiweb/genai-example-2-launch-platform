import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_ugc_moderation';

const migrationSql = (): string => {
  const name = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .find((candidate) => candidate.endsWith(TABLE_MIGRATION_SUFFIX));
  if (name === undefined) {
    throw new Error(
      `${TABLE_MIGRATION_SUFFIX}で終わるマイグレーションがありません`,
    );
  }
  return readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
};

const statementsOf = (): string[] =>
  migrationSql()
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const createModerationActionsTable = (): string => {
  const statement = statementsOf().find((part) =>
    part.startsWith('CREATE TABLE `moderation_actions` ('),
  );
  if (statement === undefined) {
    throw new Error('moderation_actionsを作る文がありません');
  }
  return statement;
};

describe('ugc-moderationの措置の記録のマイグレーション', () => {
  test('moderation_actionsを作る文と索引の文だけを含み、週ごとの統計と既存のテーブルを作らない', () => {
    const createdTables = statementsOf()
      .filter((statement) => statement.startsWith('CREATE TABLE'))
      .map((statement) => /^CREATE TABLE `([^`]+)`/.exec(statement)?.[1]);

    expect(createdTables).toEqual(['moderation_actions']);
    expect(createModerationActionsTable()).toContain('`id` text PRIMARY KEY');
    expect(migrationSql()).not.toMatch(/DROP TABLE|ALTER TABLE/);
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
    expect(migrationSql()).not.toContain('?');
  });

  test.each([
    'CREATE INDEX `moderation_actions_target_kind_target_id_occurred_at_idx` ON `moderation_actions` (`target_kind`,`target_id`,`occurred_at`);',
    'CREATE INDEX `moderation_actions_notice_status_occurred_at_idx` ON `moderation_actions` (`notice_status`,`occurred_at`);',
    'CREATE INDEX `moderation_actions_subject_user_id_idx` ON `moderation_actions` (`subject_user_id`);',
    'CREATE INDEX `moderation_actions_product_id_idx` ON `moderation_actions` (`product_id`);',
    'CREATE INDEX `moderation_actions_occurred_at_idx` ON `moderation_actions` (`occurred_at`);',
  ])('索引の文を含む: %s', (statement) => {
    expect(migrationSql()).toContain(statement);
  });

  test('他のテーブルを参照しない', () => {
    expect(migrationSql()).not.toMatch(/FOREIGN KEY|REFERENCES/);
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(migrationSql()).not.toContain('INSERT');
  });
});
