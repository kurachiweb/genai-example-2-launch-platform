import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'db',
  'migrations',
);

// 生成したSQLが上流のスキーマ(外部キー・CHECK・部分一意索引・トリガー)に通るかを確かめるため、全てのマイグレーションを適用した空のインメモリのSQLiteを作る
export function createMigratedDatabase(): Database {
  const database = new Database(':memory:');
  database.run('PRAGMA foreign_keys = ON');
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((name) => existsSync(join(MIGRATIONS_DIR, name, 'migration.sql')))
    .toSorted();
  for (const name of names) {
    database.run(
      readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'),
    );
  }
  return database;
}
