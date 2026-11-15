import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const MIGRATION_SUFFIX = '_user_profile_social';

const migrationSql = (): string => {
  const name = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .find((entryName) => entryName.endsWith(MIGRATION_SUFFIX));
  if (name === undefined) {
    throw new Error(`${MIGRATION_SUFFIX}で終わるマイグレーションがありません`);
  }
  return readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
};

describe('user-profile-socialのマイグレーション', () => {
  test('旧ハンドルの列は大文字小文字を区別しない一意の列として作られる', () => {
    expect(migrationSql()).toContain(
      '`handle` text collate nocase NOT NULL UNIQUE',
    );
  });

  test('自分自身へのフォローを拒むCHECKを含む', () => {
    expect(migrationSql()).toContain(
      'CONSTRAINT "user_follows_not_self_check" CHECK("follower_id" <> "followee_id")',
    );
  });

  test('外部Webサイトの位置を0〜9に限るCHECKを含む', () => {
    expect(migrationSql()).toContain(
      'CONSTRAINT "user_profile_websites_position_check" CHECK("position" between 0 and 9)',
    );
  });

  test('外部キーはON DELETEを指定しない', () => {
    expect(migrationSql()).not.toMatch(/ON DELETE/i);
  });
});
