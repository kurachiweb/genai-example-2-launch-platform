import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const TABLE_MIGRATION_SUFFIX = '_directory_discovery';

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

describe('directory-discoveryのテーブルのマイグレーション', () => {
  test('索引文書のテーブルを連番の主キーと一意のsource_idで作る', () => {
    const statement = createTableOf('product_search_documents');

    expect(statement).toContain('`id` integer PRIMARY KEY');
    expect(statement).toContain('`source_id` text NOT NULL UNIQUE');
    expect(statement).toContain("`name` text DEFAULT '' NOT NULL");
    expect(statement).toContain("`tagline` text DEFAULT '' NOT NULL");
  });

  test('索引文書の状態の索引を含む', () => {
    expect(migrationSql()).toContain(
      'CREATE INDEX `product_search_documents_status_idx` ON `product_search_documents` (`keyword_status`,`status_changed_at`);',
    );
  });

  test('勝利したプロダクトの記録をULIDの主キーと一意のproduct_idで作る', () => {
    const statement = createTableOf('directory_entries');

    expect(statement).toContain('`id` text PRIMARY KEY');
    expect(statement).toContain('`product_id` text NOT NULL UNIQUE');
  });

  test('投稿者の索引を含む', () => {
    expect(migrationSql()).toContain(
      'CREATE INDEX `directory_entries_owner_user_id_idx` ON `directory_entries` (`owner_user_id`);',
    );
  });

  test('外部キーはON DELETEを指定せず、投稿者のIDはusersを参照しない', () => {
    const statement = createTableOf('directory_entries');

    expect(migrationSql()).not.toMatch(/ON DELETE/i);
    expect(statement).toContain(
      'FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)',
    );
    expect(statement).not.toContain('REFERENCES `users`');
  });

  test('テーブルを作るマイグレーションは全文検索の索引と初期データを含まない', () => {
    const sql = migrationSql();

    expect(sql).not.toContain('VIRTUAL TABLE');
    expect(sql).not.toContain('TRIGGER');
    expect(sql).not.toContain('INSERT');
  });
});
