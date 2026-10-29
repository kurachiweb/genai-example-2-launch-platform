import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { rejectionMessageOf } from '../test-fixtures/rejection.ts';
import { createRepoFiles, type RepoFiles } from './repo-files.ts';

let root: string;
let files: RepoFiles;

const FIXTURE_FILES: Readonly<Record<string, string>> = {
  'apps/api/wrangler.jsonc': '{ "name": "api" }\n',
  '.github/workflows/checks.yml': 'name: checks\n',
  '.github/workflows/deploy.yml': 'name: deploy\n',
  '.github/workflows/notes.txt': 'not a workflow\n',
  '.github/actions/setup-toolchain/action.yml': 'name: setup\n',
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'delivery-repo-files-'));
  for (const [path, text] of Object.entries(FIXTURE_FILES)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  files = createRepoFiles(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('createRepoFiles', () => {
  test('リポジトリのルートを公開する', () => {
    expect(files.root).toBe(root);
  });

  test('リポジトリ相対のパスでファイルの内容を読む', async () => {
    expect(await files.readText('apps/api/wrangler.jsonc')).toBe(
      '{ "name": "api" }\n',
    );
  });

  test('読めないファイルはリポジトリ相対のパスを含むエラーで失敗する', async () => {
    expect(
      await rejectionMessageOf(files.readText('apps/event/wrangler.jsonc')),
    ).toContain('apps/event/wrangler.jsoncを読み込めませんでした');
  });

  test('ファイルの有無を返す', async () => {
    expect(await files.exists('.github/workflows/checks.yml')).toBe(true);
    expect(await files.exists('.github/workflows/missing.yml')).toBe(false);
  });

  test('パターンに一致するファイルを、ドットで始まるディレクトリを含めてリポジトリ相対のパスで並べて返す', async () => {
    expect(await files.list('.github/**/*.yml')).toEqual([
      '.github/actions/setup-toolchain/action.yml',
      '.github/workflows/checks.yml',
      '.github/workflows/deploy.yml',
    ]);
  });

  test('一致するファイルが無ければ空を返す', async () => {
    expect(await files.list('apps/infra/**/*.tf')).toEqual([]);
  });

  test.each(['../outside.txt', 'apps/../../outside.txt', '/etc/passwd'])(
    'リポジトリの外を指すパス%sは読まずに失敗する',
    async (path) => {
      expect(await rejectionMessageOf(files.readText(path))).toContain(
        `リポジトリの外を指すパスは扱えません: ${path}`,
      );
      expect(await rejectionMessageOf(files.exists(path))).toContain(
        'リポジトリの外を指すパスは扱えません',
      );
      expect(await rejectionMessageOf(files.list(path))).toContain(
        'リポジトリの外を指すパスは扱えません',
      );
    },
  );
});
