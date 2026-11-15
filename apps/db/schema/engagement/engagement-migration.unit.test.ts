import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_engagement';

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

describe('engagementのテーブルのマイグレーション', () => {
  test.each(['launch_comments', 'product_ratings'])(
    '%sを作る文を含む',
    (tableName) => {
      expect(createTableOf(tableName)).toContain('`id` text PRIMARY KEY');
    },
  );

  test.each([
    [
      'launch_comments',
      'CONSTRAINT "launch_comments_depth_check" CHECK("depth" between 1 and 3)',
    ],
    [
      'product_ratings',
      'CONSTRAINT "product_ratings_score_check" CHECK("score" in (1, 2, 3, 4, 5))',
    ],
  ])('%sのCHECK制約は値を埋め込んで作る', (tableName, constraint) => {
    expect(createTableOf(tableName)).toContain(constraint);
  });

  test('バインド変数の`?`を残さない', () => {
    expect(migrationSql()).not.toContain('?');
  });

  test.each([
    ['launch_comments', 'product_id'],
    ['launch_comments', 'launch_id'],
    ['launch_comments', 'parent_id'],
    ['launch_comments', 'author_user_id'],
    ['product_ratings', 'product_id'],
    ['product_ratings', 'user_id'],
  ])('%sの%sの外部キーは削除時の動作を指定しない', (tableName, column) => {
    const statement = createTableOf(tableName);

    expect(statement).toContain(`FOREIGN KEY (\`${column}\`) REFERENCES`);
    expect(statement).not.toContain('ON DELETE');
  });

  test('プロダクトと評価者の組の一意索引を作る', () => {
    expect(migrationSql()).toContain(
      'CREATE UNIQUE INDEX `product_ratings_product_id_user_id_unique` ON `product_ratings` (`product_id`,`user_id`);',
    );
  });
});
