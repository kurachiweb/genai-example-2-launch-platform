import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_tournament_week';

const TOURNAMENT_TABLES = [
  'tournament_brackets',
  'bracket_participants',
  'bracket_matches',
  'week_tournaments',
  'week_tournament_entries',
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

const createTableOf = (tableName: string): string => {
  const statement = migrationSql()
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`CREATE TABLE \`${tableName}\` (`));
  if (statement === undefined) {
    throw new Error(`${tableName}を作る文がありません`);
  }
  return statement;
};

describe('tournament-weekのテーブルのマイグレーション', () => {
  test.each(TOURNAMENT_TABLES)('%sを作る文を含む', (tableName) => {
    expect(createTableOf(tableName)).toMatch(
      /`(id|match_id)` text PRIMARY KEY/,
    );
  });

  test.each([
    [
      'tournament_brackets',
      `CONSTRAINT "tournament_brackets_finished_outcome_check" CHECK(("status" <> 'finished' or "outcome" is not null))`,
    ],
    [
      'tournament_brackets',
      `CONSTRAINT "tournament_brackets_champion_participant_check" CHECK(("outcome" is null or "outcome" <> 'champion' or "champion_participant_no" is not null))`,
    ],
    [
      'bracket_matches',
      `CONSTRAINT "bracket_matches_status_check" CHECK("status" in ('planned', 'scheduled', 'decided'))`,
    ],
    [
      'week_tournaments',
      `CONSTRAINT "week_tournaments_status_check" CHECK("status" in ('open', 'drawing', 'in_progress', 'finished'))`,
    ],
    [
      'week_tournament_entries',
      `CONSTRAINT "week_tournament_entries_refund_status_check" CHECK("refund_status" in ('none', 'pending', 'requested', 'not_needed', 'already_refunded', 'rejected'))`,
    ],
    [
      'week_tournament_entries',
      `CONSTRAINT "week_tournament_entries_entitled_source_check" CHECK(("status" not in ('entitled', 'drawn') or "entitlement_source" is not null))`,
    ],
    [
      'week_tournament_entries',
      `CONSTRAINT "week_tournament_entries_payment_purchase_check" CHECK(("entitlement_source" is null or "entitlement_source" <> 'payment' or "purchase_id" is not null))`,
    ],
  ])('%sのCHECK制約は値を埋め込んで作る: %s', (tableName, constraint) => {
    expect(createTableOf(tableName)).toContain(constraint);
  });

  test('バインド変数の`?`を残さない', () => {
    expect(migrationSql()).not.toContain('?');
  });

  test.each([
    [
      'tournament_brackets_kind_tournament_id_unique',
      'tournament_brackets',
      '`kind`,`tournament_id`',
    ],
    [
      'bracket_participants_bracket_id_participant_no_unique',
      'bracket_participants',
      '`bracket_id`,`participant_no`',
    ],
    [
      'bracket_participants_bracket_id_entry_ref_unique',
      'bracket_participants',
      '`bracket_id`,`entry_ref`',
    ],
    [
      'bracket_matches_bracket_id_round_position_unique',
      'bracket_matches',
      '`bracket_id`,`round`,`position`',
    ],
    ['week_tournaments_week_start_unique', 'week_tournaments', '`week_start`'],
    [
      'week_tournament_entries_launch_id_unique',
      'week_tournament_entries',
      '`launch_id`',
    ],
    [
      'week_tournament_entries_tournament_id_product_id_unique',
      'week_tournament_entries',
      '`tournament_id`,`product_id`',
    ],
  ])('一意索引%sを含む', (indexName, tableName, columns) => {
    expect(migrationSql()).toContain(
      `CREATE UNIQUE INDEX \`${indexName}\` ON \`${tableName}\` (${columns});`,
    );
  });

  test('外部キーはON DELETEを指定せず、ブラケットのマッチはマッチを参照しない', () => {
    expect(migrationSql()).not.toMatch(/ON DELETE/i);
    expect(createTableOf('bracket_matches')).not.toContain(
      'REFERENCES `matches`',
    );
    expect(createTableOf('bracket_matches')).toContain(
      'FOREIGN KEY (`bracket_id`) REFERENCES `tournament_brackets`(`id`)',
    );
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(migrationSql()).not.toContain('INSERT');
  });
});
