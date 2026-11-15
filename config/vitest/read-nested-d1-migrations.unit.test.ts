import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readNestedD1Migrations } from './read-nested-d1-migrations.ts';

let migrationsDir: string;

beforeEach(async () => {
  migrationsDir = await mkdtemp(join(tmpdir(), 'read-nested-d1-migrations-'));
});

afterEach(async () => {
  await rm(migrationsDir, { recursive: true, force: true });
});

async function writeMigration(name: string, sql: string): Promise<void> {
  await mkdir(join(migrationsDir, name));
  await writeFile(join(migrationsDir, name, 'migration.sql'), sql);
}

describe('readNestedD1Migrations', () => {
  test('入れ子のマイグレーションをディレクトリ名の順に、保存先からの相対パスを名前として読む', async () => {
    await writeMigration('20260302000000_second', 'CREATE TABLE b (id TEXT);');
    await writeMigration('20260301000000_first', 'CREATE TABLE a (id TEXT);');
    await writeMigration('20261201000000_third', 'CREATE TABLE c (id TEXT);');

    const migrations = await readNestedD1Migrations(migrationsDir);

    expect(migrations.map(({ name }) => name)).toEqual([
      '20260301000000_first/migration.sql',
      '20260302000000_second/migration.sql',
      '20261201000000_third/migration.sql',
    ]);
  });

  test('文の区切りで分割し、前後の空白と空の文を除く', async () => {
    await writeMigration(
      '20260301000000_init',
      [
        'CREATE TABLE `users` (\n\t`id` text PRIMARY KEY\n);',
        '--> statement-breakpoint',
        'CREATE INDEX `users_id_idx` ON `users` (`id`);',
        '--> statement-breakpoint',
        '',
      ].join('\n'),
    );

    const migrations = await readNestedD1Migrations(migrationsDir);

    expect(migrations).toEqual([
      {
        name: '20260301000000_init/migration.sql',
        queries: [
          'CREATE TABLE `users` (\n\t`id` text PRIMARY KEY\n);',
          'CREATE INDEX `users_id_idx` ON `users` (`id`);',
        ],
      },
    ]);
  });

  test('区切りの無いマイグレーションは1つの文として扱う', async () => {
    await writeMigration(
      '20260301000000_single',
      '\nCREATE TABLE a (id TEXT);\n',
    );

    const migrations = await readNestedD1Migrations(migrationsDir);

    expect(migrations).toEqual([
      {
        name: '20260301000000_single/migration.sql',
        queries: ['CREATE TABLE a (id TEXT);'],
      },
    ]);
  });

  test('migration.sqlを持たないディレクトリと保存先の直下のファイルを無視する', async () => {
    await writeFile(join(migrationsDir, '.gitkeep'), '');
    await writeFile(join(migrationsDir, 'stray.sql'), 'DROP TABLE a;');
    await mkdir(join(migrationsDir, '20260301000000_snapshot_only'));
    await writeFile(
      join(migrationsDir, '20260301000000_snapshot_only', 'snapshot.json'),
      '{}',
    );
    await writeMigration('20260302000000_init', 'CREATE TABLE a (id TEXT);');

    const migrations = await readNestedD1Migrations(migrationsDir);

    expect(migrations.map(({ name }) => name)).toEqual([
      '20260302000000_init/migration.sql',
    ]);
  });

  test('マイグレーションが無ければ空の配列を返す', async () => {
    await writeFile(join(migrationsDir, '.gitkeep'), '');

    const migrations = await readNestedD1Migrations(migrationsDir);

    expect(migrations).toEqual([]);
  });
});
