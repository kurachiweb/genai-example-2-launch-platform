import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_match_engine';

const MATCH_TABLES = [
  'matches',
  'match_entries',
  'match_upvotes',
  'match_events',
  'match_event_handler_runs',
  'qualifier_pairings',
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

describe('match-engineのテーブルのマイグレーション', () => {
  test.each(MATCH_TABLES)('%sを作る文を含む', (tableName) => {
    expect(createTableOf(tableName)).toContain('`id` text PRIMARY KEY');
  });

  test.each([
    [
      'matches',
      `CONSTRAINT "matches_kind_check" CHECK("kind" in ('qualifier', 'week', 'year'))`,
    ],
    [
      'matches',
      `CONSTRAINT "matches_stage_check" CHECK("stage" in ('quarterfinal', 'semifinal', 'final'))`,
    ],
    [
      'matches',
      `CONSTRAINT "matches_decision_check" CHECK("decision" in ('votes', 'last_upvote', 'no_votes', 'bye', 'walkover', 'both_forfeited'))`,
    ],
    [
      'matches',
      'CONSTRAINT "matches_starts_before_ends_check" CHECK("starts_at" < "ends_at")',
    ],
    [
      'match_entries',
      'CONSTRAINT "match_entries_slot_check" CHECK("slot" in (1, 2))',
    ],
    [
      'match_entries',
      `CONSTRAINT "match_entries_match_kind_check" CHECK("match_kind" in ('qualifier', 'week', 'year'))`,
    ],
    [
      'match_entries',
      `CONSTRAINT "match_entries_result_check" CHECK("result" in ('won', 'lost', 'bye', 'walkover'))`,
    ],
    [
      'match_events',
      `CONSTRAINT "match_events_match_kind_check" CHECK("match_kind" in ('qualifier', 'week', 'year'))`,
    ],
    [
      'match_events',
      `CONSTRAINT "match_events_type_check" CHECK("type" in ('scheduled', 'started', 'decided'))`,
    ],
    [
      'match_events',
      `CONSTRAINT "match_events_status_check" CHECK("status" in ('pending', 'completed'))`,
    ],
    [
      'qualifier_pairings',
      `CONSTRAINT "qualifier_pairings_status_check" CHECK("status" in ('pending', 'completed'))`,
    ],
  ])('%sは値を限るCHECKを含む: %s', (tableName, constraint) => {
    expect(createTableOf(tableName)).toContain(constraint);
  });

  test('予選の側のローンチを1つに限る部分一意索引を含む', () => {
    expect(migrationSql()).toContain(
      `CREATE UNIQUE INDEX \`match_entries_qualifier_launch_id_unique\` ON \`match_entries\` (\`launch_id\`) WHERE ("match_entries"."match_kind" = 'qualifier' and "match_entries"."launch_id" is not null);`,
    );
  });

  test('有効なUpvoteをマッチと利用者で1つに限る部分一意索引を含む', () => {
    expect(migrationSql()).toContain(
      'CREATE UNIQUE INDEX `match_upvotes_match_id_user_id_active_unique` ON `match_upvotes` (`match_id`,`user_id`) WHERE "match_upvotes"."deleted_at" is null;',
    );
  });

  test.each([
    [
      'match_entries_match_id_slot_unique',
      'match_entries',
      '`match_id`,`slot`',
    ],
    ['match_events_match_id_type_unique', 'match_events', '`match_id`,`type`'],
    [
      'match_event_handler_runs_event_id_handler_name_unique',
      'match_event_handler_runs',
      '`event_id`,`handler_name`',
    ],
  ])('一意索引%sを含む', (indexName, tableName, columns) => {
    expect(migrationSql()).toContain(
      `CREATE UNIQUE INDEX \`${indexName}\` ON \`${tableName}\` (${columns});`,
    );
  });

  test('ペアリングの記録の実施日は一意の列として作られる', () => {
    expect(createTableOf('qualifier_pairings')).toContain(
      '`match_date` text NOT NULL UNIQUE',
    );
  });

  test('外部キーはON DELETEを指定せず、側の投稿者のIDはusersを参照しない', () => {
    const sql = migrationSql();

    expect(sql).not.toMatch(/ON DELETE/i);
    expect(createTableOf('match_entries')).not.toContain('REFERENCES `users`');
    expect(createTableOf('match_upvotes')).toContain(
      'FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)',
    );
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(migrationSql()).not.toContain('INSERT');
  });
});
