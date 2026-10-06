import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import ts from 'typescript';

import {
  EXTERNAL_SOURCE_DIRS,
  QUALITY_GATE_EXCLUDED_DIRS,
} from './config/workspace-layout.ts';
import {
  listRepositoryFiles,
  spawnGit,
} from './scripts/tooling/check-test-names.ts';

const REPO_ROOT = import.meta.dirname;
const TSCONFIG_PATH = join(REPO_ROOT, 'tsconfig.json');
const ALL_TYPESCRIPT_FILES = '**/*.ts';
const TYPESCRIPT_FILE = /\.tsx?$/;

const NOT_ROOT_OWNED_DIRS = [
  'apps',
  ...QUALITY_GATE_EXCLUDED_DIRS,
  ...EXTERNAL_SOURCE_DIRS,
];

interface RootTsconfig {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

const readRootTsconfig = async (): Promise<RootTsconfig> =>
  JSON.parse(await readFile(TSCONFIG_PATH, 'utf8')) as RootTsconfig;

const isRootOwned = (path: string): boolean =>
  !NOT_ROOT_OWNED_DIRS.some((dir) => path.startsWith(`${dir}/`));

const rootProjectFiles = (): ReadonlySet<string> => {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    TSCONFIG_PATH,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        );
      },
    },
  );
  if (parsed === undefined) {
    throw new Error(`${TSCONFIG_PATH}を読み込めませんでした。`);
  }
  return new Set(parsed.fileNames);
};

describe('tsconfig.json', () => {
  test('ドットで始まらない場所に置いたルート所有のTSを、includeへの追記なしで型検査の対象にする', async () => {
    const { include } = await readRootTsconfig();

    expect(include).toContain(ALL_TYPESCRIPT_FILES);
  });

  test('アプリ・品質ゲートの対象外・外部由来のディレクトリを型検査の対象から外す', async () => {
    const { exclude } = await readRootTsconfig();

    expect([...(exclude ?? [])].toSorted()).toEqual(
      NOT_ROOT_OWNED_DIRS.toSorted(),
    );
  });

  // コミット時の検査はアプリにも対象外にも属さないTSをルートの静的解析へ渡し、型情報を使う規則はこの設定の対象外のファイルを解析エラーにするため
  test('リポジトリにあるルート所有のTSが、ドットで始まるディレクトリの配下も含めてすべて型検査の対象に入っている', () => {
    const projectFiles = rootProjectFiles();

    const outsideProject = listRepositoryFiles(REPO_ROOT, spawnGit)
      .filter((path) => TYPESCRIPT_FILE.test(path) && isRootOwned(path))
      .filter((path) => !projectFiles.has(join(REPO_ROOT, path)));

    expect(outsideProject).toEqual([]);
  });
});
