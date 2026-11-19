import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_public_api';

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

const createApiKeysTable = (): string => {
  const statement = statementsOf().find((part) =>
    part.startsWith('CREATE TABLE `api_keys` ('),
  );
  if (statement === undefined) {
    throw new Error('api_keysを作る文がありません');
  }
  return statement;
};

describe('public-apiのテーブルのマイグレーション', () => {
  test('api_keysを作る文と索引の文だけを含み、既存のテーブルを作り直さない', () => {
    const createdTables = statementsOf()
      .filter((statement) => statement.startsWith('CREATE TABLE'))
      .map((statement) => /^CREATE TABLE `([^`]+)`/.exec(statement)?.[1]);

    expect(createdTables).toEqual(['api_keys']);
    expect(createApiKeysTable()).toContain('`id` text PRIMARY KEY');
    expect(migrationSql()).not.toMatch(/DROP TABLE|ALTER TABLE/);
  });

  test.each([
    ['scope_products', `('none', 'read')`],
    ['scope_launches', `('none', 'read')`],
    ['scope_upvotes', `('none', 'read')`],
    ['scope_comments', `('none', 'read')`],
    ['scope_ratings', `('none', 'read')`],
    ['scope_profile', `('none', 'read', 'read_write')`],
    ['scope_product_descriptions', `('none', 'read', 'read_write')`],
  ])('%sのCHECK制約は許される値を埋め込んで作る', (column, values) => {
    expect(createApiKeysTable()).toContain(
      `CONSTRAINT "api_keys_${column}_check" CHECK("${column}" in ${values})`,
    );
  });

  test('バインド変数の`?`を残さない', () => {
    expect(migrationSql()).not.toContain('?');
  });

  test.each([
    'CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);',
    'CREATE INDEX `api_keys_user_id_created_at_id_idx` ON `api_keys` (`user_id`,`created_at`,`id`);',
  ])('索引の文を含む: %s', (statement) => {
    expect(migrationSql()).toContain(statement);
  });

  test('利用者だけを参照し、ON DELETEを指定しない', () => {
    expect(migrationSql()).not.toMatch(/ON DELETE/i);
    expect(createApiKeysTable()).toContain(
      'FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)',
    );
    expect(createApiKeysTable().match(/FOREIGN KEY/g)).toHaveLength(1);
  });

  test('作成のマイグレーションは初期データを含まない', () => {
    expect(migrationSql()).not.toContain('INSERT');
  });
});
