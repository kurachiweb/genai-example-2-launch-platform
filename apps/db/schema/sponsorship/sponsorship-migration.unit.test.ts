import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_sponsorship';

const SPONSORSHIP_TABLES = [
  'sponsorships',
  'sponsorship_display_stops',
] as const;

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

const createTableOf = (tableName: string): string => {
  const statement = statementsOf().find((part) =>
    part.startsWith(`CREATE TABLE \`${tableName}\` (`),
  );
  if (statement === undefined) {
    throw new Error(`${tableName}を作る文がありません`);
  }
  return statement;
};

describe('sponsorshipのテーブルのマイグレーション', () => {
  test.each(SPONSORSHIP_TABLES)('%sを作る文を含む', (tableName) => {
    expect(createTableOf(tableName)).toContain('`id` text PRIMARY KEY');
  });

  test('申込と表示停止の区間の2テーブルを作る文と索引の文だけを含み、既存のテーブル(決済のテーブルを含む)を作り直さない', () => {
    const createdTables = statementsOf()
      .filter((statement) => statement.startsWith('CREATE TABLE'))
      .map((statement) => /^CREATE TABLE `([^`]+)`/.exec(statement)?.[1]);

    expect(createdTables.toSorted()).toEqual(
      [...SPONSORSHIP_TABLES].toSorted(),
    );
    expect(migrationSql()).not.toMatch(/DROP TABLE|ALTER TABLE/);
    expect(migrationSql()).not.toMatch(/`payment_[a-z_]+s`/);
  });

  test.each([
    `CONSTRAINT "sponsorships_tier_check" CHECK("tier" in ('legend', 'gold', 'silver'))`,
    `CONSTRAINT "sponsorships_state_check" CHECK("state" in ('pending_payment', 'paid', 'terminated'))`,
    `CONSTRAINT "sponsorships_termination_notice_check" CHECK("termination_notice" in ('none', 'pending', 'requested', 'skipped'))`,
    `CONSTRAINT "sponsorships_stop_refund_status_check" CHECK("stop_refund_status" in ('none', 'requested', 'not_needed', 'already_refunded', 'rejected'))`,
    `CONSTRAINT "sponsorships_days_range_check" CHECK("days" between 1 and 366)`,
    `CONSTRAINT "sponsorships_paid_columns_check" CHECK(("state" not in ('paid', 'terminated') or ("purchase_id" is not null and "payment_record_id" is not null and "amount_total" is not null and "paid_at" is not null)))`,
    `CONSTRAINT "sponsorships_terminated_columns_check" CHECK(("state" <> 'terminated' or ("terminated_at" is not null and "termination_reason" is not null)))`,
  ])('申込のCHECK制約は値を埋め込んで作る: %s', (constraint) => {
    expect(createTableOf('sponsorships')).toContain(constraint);
  });

  test('表示停止の区間の主体の種類のCHECK制約は値を埋め込んで作る', () => {
    expect(createTableOf('sponsorship_display_stops')).toContain(
      `CONSTRAINT "sponsorship_display_stops_subject_kind_check" CHECK("subject_kind" in ('product', 'user'))`,
    );
  });

  test('バインド変数の`?`を残さない', () => {
    expect(migrationSql()).not.toContain('?');
  });

  test.each([
    'CREATE INDEX `sponsorships_display_idx` ON `sponsorships` (`state`,`starts_on`,`ends_on`);',
    'CREATE INDEX `sponsorships_user_idx` ON `sponsorships` (`user_id`,`created_at`);',
    'CREATE INDEX `sponsorships_product_tier_idx` ON `sponsorships` (`product_id`,`tier`,`state`);',
    'CREATE INDEX `sponsorships_created_idx` ON `sponsorships` (`created_at`);',
    `CREATE INDEX \`sponsorships_unsettled_end_idx\` ON \`sponsorships\` (\`ends_on\`) WHERE ("sponsorships"."state" = 'paid' and "sponsorships"."deleted_at" is null and ("sponsorships"."stop_refund_status" = 'none' or "sponsorships"."end_notice" = 'none'));`,
    `CREATE INDEX \`sponsorships_pending_notice_idx\` ON \`sponsorships\` (\`updated_at\`) WHERE ("sponsorships"."start_notice" = 'pending' or "sponsorships"."end_notice" = 'pending' or "sponsorships"."termination_notice" = 'pending');`,
    'CREATE INDEX `sponsorship_display_stops_subject_idx` ON `sponsorship_display_stops` (`subject_kind`,`subject_id`,`started_at`);',
  ])('索引の文を含む: %s', (statement) => {
    expect(migrationSql()).toContain(statement);
  });

  test('申込は利用者とプロダクトだけを参照し、ON DELETEを指定せず、表示停止の区間は外部キーを持たない', () => {
    expect(migrationSql()).not.toMatch(/ON DELETE/i);
    expect(createTableOf('sponsorships')).toContain(
      'FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)',
    );
    expect(createTableOf('sponsorships')).toContain(
      'FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)',
    );
    expect(createTableOf('sponsorships').match(/FOREIGN KEY/g)).toHaveLength(2);
    expect(createTableOf('sponsorship_display_stops')).not.toContain(
      'FOREIGN KEY',
    );
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(migrationSql()).not.toContain('INSERT');
  });
});
