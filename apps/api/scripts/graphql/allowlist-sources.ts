import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import type { CallerKind } from '../../src/presentation/gateway/gateway-headers.ts';
import type {
  PersistedDocuments,
  PersistedDocumentsByCaller,
} from './allowlist-builder.ts';

export interface AllowlistSource {
  readonly repoPath: string;
}

export const ALLOWLIST_SOURCES = Object.freeze({
  client: {
    repoPath: 'apps/client/src/graphql/generated/persisted-documents.json',
  },
  admin: {
    repoPath: 'apps/admin/src/graphql/generated/persisted-documents.json',
  },
}) satisfies Readonly<Record<CallerKind, AllowlistSource>>;

const persistedDocumentsSchema = z.record(z.string(), z.string());

interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function parsePersistedDocuments(
  content: string,
  location: string,
): PersistedDocuments {
  try {
    return persistedDocumentsSchema.parse(JSON.parse(content));
  } catch (error) {
    throw new Error(`操作の一覧の形式が正しくありません(${location})`, {
      cause: error,
    });
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function readWorkingTreeSource(
  repoRoot: string,
  { repoPath }: AllowlistSource,
): Promise<PersistedDocuments> {
  try {
    const content = await readFile(join(repoRoot, repoPath), 'utf8');
    return parsePersistedDocuments(content, repoPath);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return {};
    }
    throw error;
  }
}

async function readSources(
  read: (source: AllowlistSource) => Promise<PersistedDocuments>,
): Promise<PersistedDocumentsByCaller> {
  const [client, admin] = await Promise.all([
    read(ALLOWLIST_SOURCES.client),
    read(ALLOWLIST_SOURCES.admin),
  ]);
  return { client, admin };
}

export async function readWorkingTreeSources(
  repoRoot: string,
): Promise<PersistedDocumentsByCaller> {
  return readSources((source) => readWorkingTreeSource(repoRoot, source));
}

// 指定の値をシェルに解釈させないよう、シェルを介さず引数の配列で起動する
async function runGit(
  repoRoot: string,
  args: readonly string[],
): Promise<GitResult> {
  const child = Bun.spawn(['git', '-C', repoRoot, ...args], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function runGitOrThrow(
  repoRoot: string,
  args: readonly string[],
): Promise<string> {
  const result = await runGit(repoRoot, args);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')}が失敗しました: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

// オプションに見える値も参照として扱わせるため--end-of-optionsで区切り、コミット以外のオブジェクトは^{commit}で拒否する
async function resolveCommit(repoRoot: string, ref: string): Promise<string> {
  const result = await runGit(repoRoot, [
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `${ref}^{commit}`,
  ]);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim();
    const suffix = detail === '' ? '' : `(git: ${detail})`;
    throw new Error(
      `直前のリリースのコミットが見つかりません: ${ref}${suffix}`,
    );
  }
  return result.stdout.trim();
}

// ls-treeは指定のパスがそのコミットに無ければ何も出力しないため、無いことと読み出しの失敗を区別できる
async function readGitSource(
  repoRoot: string,
  commit: string,
  { repoPath }: AllowlistSource,
): Promise<PersistedDocuments> {
  const listing = await runGitOrThrow(repoRoot, [
    'ls-tree',
    '--full-tree',
    '--format=%(objecttype) %(objectname)',
    commit,
    '--',
    repoPath,
  ]);
  const [objectType, objectName] = listing.trim().split(' ');
  if (objectType !== 'blob' || objectName === undefined) {
    return {};
  }
  const content = await runGitOrThrow(repoRoot, [
    'cat-file',
    'blob',
    objectName,
  ]);
  return parsePersistedDocuments(content, `${repoPath}@${commit}`);
}

export async function readGitSources(
  repoRoot: string,
  ref: string,
): Promise<PersistedDocumentsByCaller> {
  const commit = await resolveCommit(repoRoot, ref);
  return readSources((source) => readGitSource(repoRoot, commit, source));
}
