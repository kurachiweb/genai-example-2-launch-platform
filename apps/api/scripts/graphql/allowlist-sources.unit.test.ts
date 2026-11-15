import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { PersistedDocuments } from './allowlist-builder.ts';
import {
  ALLOWLIST_SOURCES,
  readGitSources,
  readWorkingTreeSources,
} from './allowlist-sources.ts';

const CLIENT_DOCUMENTS: PersistedDocuments = {
  'sha256:4816c43da17b44d5d6b343d6827d091e5f937690d59998beb3f58cf60a1e63dd':
    'query ClientValue { clientValue }',
};

const ADMIN_DOCUMENTS: PersistedDocuments = {
  'sha256:50be504394d59b79d7ed0f17a442f9d5806429e42d0c07323ea0fe2be9ad46bd':
    'query AdminValue { adminValue }',
};

const NEWER_CLIENT_DOCUMENTS: PersistedDocuments = {
  'sha256:0000000000000000000000000000000000000000000000000000000000000000':
    'query Newer { clientValue }',
};

const EMPTY_SOURCES = { client: {}, admin: {} };

const createdDirs: string[] = [];

afterAll(async () => {
  await Promise.all(
    createdDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'allowlist-sources-test-'));
  createdDirs.push(dir);
  return dir;
}

// 作業ツリーのGit設定やフック・利用者のGit設定に触れないよう、HOMEを一時ディレクトリに向けシステム設定も読ませない
function runGit(repoDir: string, args: readonly string[]): void {
  const result = Bun.spawnSync(
    [
      'git',
      '-c',
      'user.name=Allowlist Test',
      '-c',
      'user.email=allowlist-test@launch.example',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    {
      cwd: repoDir,
      env: { PATH: process.env.PATH, HOME: repoDir, GIT_CONFIG_NOSYSTEM: '1' },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')}が失敗した: ${result.stderr.toString()}`,
    );
  }
}

async function writeRepoFile(
  repoDir: string,
  repoPath: string,
  content: string,
): Promise<void> {
  const path = join(repoDir, repoPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function writeSource(
  repoDir: string,
  repoPath: string,
  documents: PersistedDocuments,
): Promise<void> {
  await writeRepoFile(repoDir, repoPath, JSON.stringify(documents, null, 2));
}

async function createRepository(): Promise<string> {
  const repoDir = await createTempDir();
  runGit(repoDir, ['init', '--quiet']);
  await writeRepoFile(repoDir, 'README.md', '# test\n');
  runGit(repoDir, ['add', '--', 'README.md']);
  runGit(repoDir, ['commit', '--quiet', '--no-verify', '-m', 'initial']);
  return repoDir;
}

function commitAll(repoDir: string, message: string): void {
  runGit(repoDir, ['add', '--all']);
  runGit(repoDir, ['commit', '--quiet', '--no-verify', '-m', message]);
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  const rejection: unknown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(rejection instanceof Error)) {
    throw new Error('例外が投げられなかった');
  }
  return rejection.message;
}

describe('ALLOWLIST_SOURCES', () => {
  test('利用者側・管理者側の操作の一覧の場所は、各フロントエンドのclient-presetの持続化文書である', () => {
    expect(ALLOWLIST_SOURCES).toEqual({
      client: {
        repoPath: 'apps/client/src/graphql/generated/persisted-documents.json',
      },
      admin: {
        repoPath: 'apps/admin/src/graphql/generated/persisted-documents.json',
      },
    });
  });
});

describe('readWorkingTreeSources', () => {
  test('作業ツリーに操作の一覧が無ければ、呼び出し元ごとに空の一覧を返す', async () => {
    const repoDir = await createTempDir();

    expect(await readWorkingTreeSources(repoDir)).toEqual(EMPTY_SOURCES);
  });

  test('作業ツリーの操作の一覧を呼び出し元ごとに読み、無い方は空にする', async () => {
    const repoDir = await createTempDir();
    await writeSource(
      repoDir,
      ALLOWLIST_SOURCES.client.repoPath,
      CLIENT_DOCUMENTS,
    );

    expect(await readWorkingTreeSources(repoDir)).toEqual({
      client: CLIENT_DOCUMENTS,
      admin: {},
    });
  });

  test('利用者側と管理者側の両方の一覧を読む', async () => {
    const repoDir = await createTempDir();
    await writeSource(
      repoDir,
      ALLOWLIST_SOURCES.client.repoPath,
      CLIENT_DOCUMENTS,
    );
    await writeSource(
      repoDir,
      ALLOWLIST_SOURCES.admin.repoPath,
      ADMIN_DOCUMENTS,
    );

    expect(await readWorkingTreeSources(repoDir)).toEqual({
      client: CLIENT_DOCUMENTS,
      admin: ADMIN_DOCUMENTS,
    });
  });

  test.each([
    ['JSONとして解析できない', '{"sha256:'],
    ['本文が文字列でない', '{"sha256:abc": 1}'],
    ['オブジェクトでない', '["query A { a }"]'],
  ])(
    '一覧の形式が正しくなければ(%s)、場所を含む例外を投げる',
    async (_label, content) => {
      const repoDir = await createTempDir();
      await writeRepoFile(repoDir, ALLOWLIST_SOURCES.admin.repoPath, content);

      expect(await rejectionMessage(readWorkingTreeSources(repoDir))).toContain(
        `操作の一覧の形式が正しくありません(${ALLOWLIST_SOURCES.admin.repoPath})`,
      );
    },
  );
});

describe('readGitSources', () => {
  test('指定したコミットに操作の一覧が無ければ、呼び出し元ごとに空の一覧を返す', async () => {
    const repoDir = await createRepository();

    expect(await readGitSources(repoDir, 'HEAD')).toEqual(EMPTY_SOURCES);
  });

  test('作業ツリーではなく指定したコミットの時点の一覧を読む', async () => {
    const repoDir = await createRepository();
    await writeSource(
      repoDir,
      ALLOWLIST_SOURCES.client.repoPath,
      CLIENT_DOCUMENTS,
    );
    await writeSource(
      repoDir,
      ALLOWLIST_SOURCES.admin.repoPath,
      ADMIN_DOCUMENTS,
    );
    commitAll(repoDir, 'add persisted documents');
    await writeSource(
      repoDir,
      ALLOWLIST_SOURCES.client.repoPath,
      NEWER_CLIENT_DOCUMENTS,
    );
    commitAll(repoDir, 'update persisted documents');

    expect(await readGitSources(repoDir, 'HEAD~1')).toEqual({
      client: CLIENT_DOCUMENTS,
      admin: ADMIN_DOCUMENTS,
    });
    expect(await readGitSources(repoDir, 'HEAD~2')).toEqual(EMPTY_SOURCES);
  });

  test('指定したコミットの一覧の形式が正しくなければ、場所を含む例外を投げる', async () => {
    const repoDir = await createRepository();
    await writeRepoFile(
      repoDir,
      ALLOWLIST_SOURCES.client.repoPath,
      '{"sha256:abc": null}',
    );
    commitAll(repoDir, 'add broken persisted documents');

    expect(await rejectionMessage(readGitSources(repoDir, 'HEAD'))).toContain(
      `操作の一覧の形式が正しくありません(${ALLOWLIST_SOURCES.client.repoPath}`,
    );
  });

  test.each([
    ['存在しないコミット', '0123456789abcdef0123456789abcdef01234567'],
    ['存在しない参照', 'no-such-branch'],
    ['オプションに見える値', '--all'],
  ])('%sを指定すると、指定した値を含む例外を投げる', async (_label, ref) => {
    const repoDir = await createRepository();

    expect(await rejectionMessage(readGitSources(repoDir, ref))).toContain(
      `直前のリリースのコミットが見つかりません: ${ref}`,
    );
  });

  test('Gitのリポジトリでなければ、Gitのエラー出力を含む例外を投げる', async () => {
    const outside = await createTempDir();

    expect(await rejectionMessage(readGitSources(outside, 'HEAD'))).toMatch(
      /^直前のリリースのコミットが見つかりません: HEAD\(git: .*not a git repository/,
    );
  });
});
