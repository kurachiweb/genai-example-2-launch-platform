import { describe, expect, test } from 'bun:test';

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '..', '..', 'migrations');

const MIGRATION_SUFFIX = '_data_export';

const migrationDirectoryNames = (): string[] =>
  readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

const migrationName = (): string => {
  const found = migrationDirectoryNames().filter((name) =>
    name.endsWith(MIGRATION_SUFFIX),
  );
  const [name] = found;
  if (found.length !== 1 || name === undefined) {
    throw new Error(
      `${MIGRATION_SUFFIX}で終わるマイグレーションを1つだけ見つけられません(${String(found.length)}件)`,
    );
  }
  return name;
};

const migrationSql = (): string =>
  readFileSync(join(MIGRATIONS_DIR, migrationName(), 'migration.sql'), 'utf8');

const statements = (): string[] =>
  migrationSql()
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const createTable = (): string => {
  const statement = statements().find((part) =>
    part.startsWith('CREATE TABLE `data_exports` ('),
  );
  if (statement === undefined) {
    throw new Error('data_exportsを作る文がありません');
  }
  return statement;
};

describe('data-exportのテーブルのマイグレーション', () => {
  test('data_exportsだけを作り、既存のテーブルを変えない', () => {
    const created = statements()
      .filter((statement) => statement.startsWith('CREATE TABLE'))
      .map((statement) => /^CREATE TABLE `([^`]+)`/.exec(statement)?.[1]);

    expect(created).toEqual(['data_exports']);
    expect(migrationSql()).not.toMatch(/DROP TABLE|ALTER TABLE/);
  });

  test.each([
    `CONSTRAINT "data_exports_status_check" CHECK("status" in ('queued', 'generating', 'ready', 'expired', 'failed'))`,
    `CONSTRAINT "data_exports_failure_kind_check" CHECK("failure_kind" in ('error', 'too_large'))`,
    `CONSTRAINT "data_exports_notice_status_check" CHECK("notice_status" in ('none', 'pending', 'requested', 'skipped'))`,
    `CONSTRAINT "data_exports_ready_check" CHECK(("status" <> 'ready' or ("object_key" is not null and "file_name" is not null and "byte_size" is not null and "completed_at" is not null and "expires_at" is not null and "upload_id" is null)))`,
    `CONSTRAINT "data_exports_expired_check" CHECK(("status" <> 'expired' or ("file_name" is not null and "byte_size" is not null and "completed_at" is not null and "expires_at" is not null and "object_key" is null and "upload_id" is null)))`,
    `CONSTRAINT "data_exports_failed_check" CHECK(("status" <> 'failed' or ("failed_at" is not null and "failure_kind" is not null)))`,
  ])('値と整合を限るCHECKを含む: %s', (constraint) => {
    expect(createTable()).toContain(constraint);
  });

  test('利用者だけを参照し、削除時の動作を指定しない', () => {
    expect(createTable()).toContain(
      'FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)',
    );
    expect(createTable().match(/REFERENCES/g)).toHaveLength(1);
    expect(migrationSql()).not.toMatch(/ON DELETE/i);
  });

  test('通知の状態と試行回数は既定値を持つNOT NULLの列として作られる', () => {
    expect(createTable()).toContain(
      "`notice_status` text DEFAULT 'none' NOT NULL",
    );
    expect(createTable()).toContain('`attempts` integer DEFAULT 0 NOT NULL');
  });

  test.each([
    'CREATE INDEX `data_exports_user_id_requested_at_idx` ON `data_exports` (`user_id`,`requested_at`);',
    'CREATE INDEX `data_exports_status_expires_at_idx` ON `data_exports` (`status`,`expires_at`);',
    'CREATE INDEX `data_exports_status_upload_id_idx` ON `data_exports` (`status`,`upload_id`);',
    'CREATE INDEX `data_exports_status_requested_at_idx` ON `data_exports` (`status`,`requested_at`);',
    'CREATE INDEX `data_exports_notice_status_updated_at_idx` ON `data_exports` (`notice_status`,`updated_at`);',
  ])('索引の文を含む: %s', (statement) => {
    expect(migrationSql()).toContain(statement);
  });

  test('バインド変数の`?`を残さず、初期データを含まない', () => {
    expect(migrationSql()).not.toContain('?');
    expect(migrationSql()).not.toContain('INSERT');
  });
});
