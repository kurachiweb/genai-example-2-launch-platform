import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

  test('リポジトリ相対のパスへ、無いディレクトリを作って内容を書き出す', async () => {
    await files.writeText('coverage/merged/lcov.info', 'SF:a.ts\n');

    expect(
      await readFile(join(root, 'coverage/merged/lcov.info'), 'utf8'),
    ).toBe('SF:a.ts\n');
  });

  test('既にあるファイルは内容を置き換える', async () => {
    await files.writeText('coverage/merged/lcov.info', 'SF:old.ts\n');
    await files.writeText('coverage/merged/lcov.info', 'SF:new.ts\n');

    expect(await files.readText('coverage/merged/lcov.info')).toBe(
      'SF:new.ts\n',
    );
  });

  test('書き出せなければリポジトリ相対のパスを含むエラーで失敗する', async () => {
    expect(
      await rejectionMessageOf(
        files.writeText('apps/api/wrangler.jsonc/child.txt', 'x'),
      ),
    ).toContain('apps/api/wrangler.jsonc/child.txtへ書き出せませんでした');
  });

  test.each(['../outside.txt', 'apps/../../outside.txt', '/etc/passwd'])(
    'リポジトリの外を指すパス%sへは書き出さずに失敗する',
    async (path) => {
      expect(await rejectionMessageOf(files.writeText(path, 'x'))).toContain(
        `リポジトリの外を指すパスは扱えません: ${path}`,
      );
    },
  );

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
