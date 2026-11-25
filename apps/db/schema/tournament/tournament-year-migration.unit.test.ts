import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_tournament_year';

const YEAR_TABLES = ['year_tournaments', 'year_tournament_entries'] as const;

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

describe('tournament-yearのテーブルのマイグレーション', () => {
  test.each(YEAR_TABLES)('%sを作る文を含む', (tableName) => {
    expect(createTableOf(tableName)).toContain('`id` text PRIMARY KEY');
  });

  test('Yearの2テーブルを作る文と索引の文だけを含み、既存のテーブルを作り直さない', () => {
    const createdTables = statementsOf()
      .filter((statement) => statement.startsWith('CREATE TABLE'))
      .map((statement) => /^CREATE TABLE `([^`]+)`/.exec(statement)?.[1]);

    expect(createdTables.toSorted()).toEqual([...YEAR_TABLES].toSorted());
    expect(migrationSql()).not.toMatch(/DROP TABLE|ALTER TABLE/);
  });

  test.each([
    [
      'year_tournaments',
      `CONSTRAINT "year_tournaments_year_range_check" CHECK("year" between 1000 and 9999)`,
    ],
    [
      'year_tournaments',
      `CONSTRAINT "year_tournaments_final_date_source_check" CHECK("final_date_source" in ('explicit', 'default'))`,
    ],
    [
      'year_tournaments',
      `CONSTRAINT "year_tournaments_explicit_version_check" CHECK(("final_date_source" <> 'explicit' or "final_date_version" >= 1))`,
    ],
    [
      'year_tournaments',
      `CONSTRAINT "year_tournaments_finished_outcome_check" CHECK(("status" <> 'finished' or "outcome" is not null))`,
    ],
    [
      'year_tournaments',
      `CONSTRAINT "year_tournaments_awarded_champion_check" CHECK(("outcome" is null or "outcome" <> 'awarded' or "champion_entry_id" is not null))`,
    ],
    [
      'year_tournament_entries',
      `CONSTRAINT "year_tournament_entries_close_reason_check" CHECK("close_reason" in ('deadline', 'deleted', 'withdrawn', 'hidden_or_suspended', 'over_capacity', 'late_entry'))`,
    ],
    [
      'year_tournament_entries',
      `CONSTRAINT "year_tournament_entries_refund_status_check" CHECK("refund_status" in ('none', 'pending', 'requested', 'not_needed', 'already_refunded', 'rejected'))`,
    ],
    [
      'year_tournament_entries',
      `CONSTRAINT "year_tournament_entries_entitled_source_check" CHECK(("status" not in ('entitled', 'drawn') or "entitlement_source" is not null))`,
    ],
    [
      'year_tournament_entries',
      `CONSTRAINT "year_tournament_entries_payment_purchase_check" CHECK(("entitlement_source" is null or "entitlement_source" <> 'payment' or "purchase_id" is not null))`,
    ],
    [
      'year_tournament_entries',
      `CONSTRAINT "year_tournament_entries_classified_year_check" CHECK(("classified_year" is not null or ("status" not in ('drawn', 'excluded') and ("close_reason" is null or "close_reason" <> 'late_entry'))))`,
    ],
  ])('%sのCHECK制約は値を埋め込んで作る: %s', (tableName, constraint) => {
    expect(createTableOf(tableName)).toContain(constraint);
  });

  test('バインド変数の`?`を残さない', () => {
    expect(migrationSql()).not.toContain('?');
  });

  test.each([
    ['year_tournaments_year_unique', 'year_tournaments', '`year`'],
    [
      'year_tournament_entries_week_tournament_id_unique',
      'year_tournament_entries',
      '`week_tournament_id`',
    ],
    [
      'year_tournament_entries_launch_id_unique',
      'year_tournament_entries',
      '`launch_id`',
    ],
  ])('一意索引%sを含む', (indexName, tableName, columns) => {
    expect(migrationSql()).toContain(
      `CREATE UNIQUE INDEX \`${indexName}\` ON \`${tableName}\` (${columns});`,
    );
  });

  test('外部キーはON DELETEを指定せず、年のトーナメントはブラケットだけを参照し、他のspecの識別子は参照しない', () => {
    expect(migrationSql()).not.toMatch(/ON DELETE/i);
    expect(createTableOf('year_tournaments')).toContain(
      'FOREIGN KEY (`bracket_id`) REFERENCES `tournament_brackets`(`id`)',
    );
    expect(migrationSql()).not.toMatch(
      /FOREIGN KEY \(`(week_tournament_id|purchase_id|final_date_updated_by_admin_id|champion_entry_id|qualifier_match_id)`\)/,
    );
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(migrationSql()).not.toContain('INSERT');
  });
});
