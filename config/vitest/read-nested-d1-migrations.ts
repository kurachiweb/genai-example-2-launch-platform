import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// @cloudflare/vitest-pool-workersのD1Migrationと同じ形。ルートはこのパッケージを依存に持たないため、型を読み込まずに定義する。
// Miniflareのバインディングの値の型(JSON)へ代入できるよう、暗黙の添字シグネチャを持つ型エイリアスにする
export type D1Migration = {
  readonly name: string;
  readonly queries: string[];
};

const MIGRATION_FILE_NAME = 'migration.sql';

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

// readD1Migrationsは保存先の直下の*.sqlしか読まないため、drizzle-kitの<名前>/migration.sqlの入れ子構造を読む。
// 名前はWranglerが適用済みとして記録する保存先からの相対パスにそろえる
export async function readNestedD1Migrations(
  migrationsDir: string,
): Promise<D1Migration[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const directoryNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

  const migrations = await Promise.all(
    directoryNames.map((directoryName) =>
      readMigration(migrationsDir, directoryName),
    ),
  );

  return migrations.filter((migration) => migration !== undefined);
}

async function readMigration(
  migrationsDir: string,
  directoryName: string,
): Promise<D1Migration | undefined> {
  const files = await readdir(join(migrationsDir, directoryName));
  if (!files.includes(MIGRATION_FILE_NAME)) {
    return undefined;
  }

  const sql = await readFile(
    join(migrationsDir, directoryName, MIGRATION_FILE_NAME),
    'utf8',
  );

  return {
    name: `${directoryName}/${MIGRATION_FILE_NAME}`,
    queries: sql
      .split(STATEMENT_BREAKPOINT)
      .map((query) => query.trim())
      .filter((query) => query !== ''),
  };
}
