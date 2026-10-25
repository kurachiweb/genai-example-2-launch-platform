import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  compareMigrations,
  listMigrationNames,
  parseMigrationsListOutput,
} from './migration-check/compare-migrations.ts';

const LOCAL_DATABASE_NAME = 'genai-example-2-dev';

const API_DIR = resolve(import.meta.dirname, '..');

const MIGRATIONS_DIR = join(API_DIR, 'db', 'migrations');

const WRANGLER_BIN = join(API_DIR, 'node_modules', '.bin', 'wrangler');

const formatNames = (names: readonly string[]): string =>
  names.map((name) => `  ${name}\n`).join('');

// 共有のローカル状態に適用済みの記録があると未適用の一覧から外れるため、空の一時ディレクトリを保存先にして全件を未適用として一覧させる
async function listUnappliedMigrations(): Promise<string> {
  const persistDir = await mkdtemp(join(tmpdir(), 'check-migrations-'));
  try {
    const wrangler = Bun.spawn(
      [
        WRANGLER_BIN,
        'd1',
        'migrations',
        'list',
        LOCAL_DATABASE_NAME,
        '--local',
        '--persist-to',
        persistDir,
      ],
      { cwd: API_DIR, stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(wrangler.stdout).text(),
      new Response(wrangler.stderr).text(),
      wrangler.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `wrangler d1 migrations listが終了コード${String(exitCode)}で失敗しました。\n${stdout}${stderr}`,
      );
    }
    return stdout;
  } finally {
    await rm(persistDir, { recursive: true, force: true });
  }
}

async function checkMigrations(): Promise<number> {
  const stored = listMigrationNames(
    await readdir(MIGRATIONS_DIR, { recursive: true }),
  );
  const listed = parseMigrationsListOutput(await listUnappliedMigrations());
  const { ok, undetected, unexpected } = compareMigrations(stored, listed);

  if (ok && stored.length === 0) {
    process.stdout.write(
      'マイグレーションは0件で、Wranglerも0件と表示しました。\n',
    );
    return 0;
  }
  if (ok) {
    process.stdout.write(
      `マイグレーション${String(stored.length)}件がすべてWranglerに検出されました。\n${formatNames(stored)}`,
    );
    return 0;
  }
  if (undetected.length > 0) {
    process.stderr.write(
      `Wranglerに検出されなかったマイグレーションが${String(undetected.length)}件あります。\n${formatNames(undetected)}`,
    );
  }
  if (unexpected.length > 0) {
    process.stderr.write(
      `保存先に無いマイグレーションをWranglerが${String(unexpected.length)}件検出しました。\n${formatNames(unexpected)}`,
    );
  }
  return 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await checkMigrations();
  } catch (error) {
    process.stderr.write(
      `マイグレーションの検出確認を完了できませんでした: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
