import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import {
  GENERATED_CODE_PATTERNS,
  TEST_FILE_PATTERNS,
} from '../../config/test-patterns.ts';
import {
  APPS,
  EXTERNAL_SOURCE_DIRS,
  QUALITY_GATE_EXCLUDED_DIRS,
} from '../../config/workspace-layout.ts';
import { createBaseConfig } from '../../eslint.config.base.ts';
import {
  findMisnamedTestFiles,
  formatMisnamedTestFiles,
  type GitCommandResult,
  type GitRunner,
  listRepositoryFiles,
  runTestNameCheckEntry,
  selectCheckTargets,
  spawnGit,
} from './check-test-names.ts';

const REPO_ROOT = join(import.meta.dirname, '../..');
const SCRIPT_PATH = join(import.meta.dirname, 'check-test-names.ts');
const SPAWN_TIMEOUT_MS = 30_000;

const ALL_NAMING_PATTERNS = Object.values(TEST_FILE_PATTERNS).flat();

const NO_MISNAMED_MESSAGE =
  '命名規約に一致しないテストファイルはありません。\n';

const CONVENTION_LINES = [
  '  単体テスト: **/*.unit.test.ts',
  '  ブラウザテスト: **/*.browser.test.{ts,tsx}',
  '  Workers統合テスト: **/*.worker.test.{ts,tsx}',
  '  E2Eテスト: e2e/**/*.e2e.test.ts',
];

const misnamedReportOf = (paths: readonly string[]): string =>
  [
    `命名規約に一致しないテストファイルが${String(paths.length)}件あります。`,
    ...paths.map((path) => `  ${path}`),
    'テストの種別に合わせて、次のいずれかの命名規約に従う名前へ変更してください。',
    ...CONVENTION_LINES,
    '',
  ].join('\n');

const WELL_NAMED_TEST_FILES = [
  'foo.unit.test.ts',
  'config/test-patterns.unit.test.ts',
  'apps/client/src/button.browser.test.tsx',
  'apps/frontend-lib/utilities/format.browser.test.ts',
  'apps/api/src/route.worker.test.ts',
  'apps/event/src/queue.worker.test.tsx',
  'e2e/login.e2e.test.ts',
  'e2e/client/vote.e2e.test.ts',
];

const NON_TEST_FILES = [
  'foo.ts',
  'test-utils.ts',
  'apps/api/test/helpers.ts',
  'apps/api/src/fixtures.test.json',
  'docs/latest.spec.md',
];

describe('findMisnamedTestFiles', () => {
  test('種別を含まないfoo.test.tsとbar.spec.tsxを、4種の命名規約とともに検出する', () => {
    const result = findMisnamedTestFiles([
      'foo.test.ts',
      'apps/client/src/bar.spec.tsx',
    ]);

    expect(result).toEqual([
      { path: 'foo.test.ts', expected: ALL_NAMING_PATTERNS },
      { path: 'apps/client/src/bar.spec.tsx', expected: ALL_NAMING_PATTERNS },
    ]);
  });

  test('4種の命名規約が単一定義のパターンそのものである', () => {
    const [first] = findMisnamedTestFiles(['foo.test.ts']);

    expect(first?.expected).toEqual([
      '**/*.unit.test.ts',
      '**/*.browser.test.{ts,tsx}',
      '**/*.worker.test.{ts,tsx}',
      'e2e/**/*.e2e.test.ts',
    ]);
  });

  test.each(WELL_NAMED_TEST_FILES)(
    '4種の命名に一致する%sは検出しない',
    (path) => {
      expect(findMisnamedTestFiles([path])).toEqual([]);
    },
  );

  test.each(NON_TEST_FILES)('テストとみなされない%sは検出しない', (path) => {
    expect(findMisnamedTestFiles([path])).toEqual([]);
  });

  test.each([
    'apps/api/src/legacy_test.js',
    'apps/api/src/legacy_spec.mts',
    'apps/api/src/usecase.unit.test.tsx',
    'apps/api/src/route.worker.test.js',
    'apps/client/src/login.e2e.test.ts',
    'e2e/login.e2e.spec.ts',
  ])(
    'テストとみなされる名前で4種の命名のどれにも一致しない%sを検出する',
    (path) => {
      expect(findMisnamedTestFiles([path]).map((file) => file.path)).toEqual([
        path,
      ]);
    },
  );

  test('混在した一覧から命名規約に一致しないファイルだけを入力の順に返す', () => {
    const result = findMisnamedTestFiles([
      'b.test.ts',
      ...WELL_NAMED_TEST_FILES,
      ...NON_TEST_FILES,
      'a.spec.ts',
    ]);

    expect(result.map(({ path }) => path)).toEqual(['b.test.ts', 'a.spec.ts']);
  });

  test('空の一覧では何も返さない', () => {
    expect(findMisnamedTestFiles([])).toEqual([]);
  });
});

describe('selectCheckTargets', () => {
  test.each([
    'mockups/src/routes/index.test.tsx',
    '.claude/hooks/hook.test.js',
    'docs/ai-extensions/sample.test.ts',
    '.kiro/settings/templates/sample.test.ts',
  ])('品質ゲートの対象外と外部由来の%sを検査対象から外す', (path) => {
    expect(selectCheckTargets([path])).toEqual([]);
  });

  test.each([
    'foo.test.ts',
    'mockups-legacy/foo.test.ts',
    'apps/mockups/foo.test.ts',
    'docs/ai-extensions-notes/foo.test.ts',
    '.kiro/specs/dev-tooling/foo.test.ts',
  ])('対象外ディレクトリの配下ではない%sは検査対象に残す', (path) => {
    expect(selectCheckTargets([path])).toEqual([path]);
  });
});

describe('formatMisnamedTestFiles', () => {
  test('該当ファイルの一覧と、種別ごとの正しい命名規約を表示する', () => {
    const message = formatMisnamedTestFiles(
      findMisnamedTestFiles(['foo.test.ts', 'apps/client/src/bar.spec.tsx']),
    );

    expect(message).toBe(
      misnamedReportOf(['foo.test.ts', 'apps/client/src/bar.spec.tsx']),
    );
  });
});

const ok = (stdout: string): GitCommandResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
});

const createFakeGit = (responses: Readonly<Record<string, GitCommandResult>>) =>
  mock<GitRunner>((args) => {
    const response = responses[args[0] ?? ''];
    if (response === undefined) {
      throw new Error(`想定外のgitコマンド: ${args.join(' ')}`);
    }
    return response;
  });

const LS_FILES_ARGS = [
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '-z',
];

describe('listRepositoryFiles', () => {
  test('作業ツリーのルートで、管理対象と無視対象を除く未追跡のファイル一覧をNUL区切りで取得する', () => {
    const git = createFakeGit({
      'rev-parse': ok('/repo\n'),
      'ls-files': ok('a b.ts\0apps/api/src/foo.test.ts\0'),
    });

    const files = listRepositoryFiles('/repo/apps/api', git);

    expect(files).toEqual(['a b.ts', 'apps/api/src/foo.test.ts']);
    expect(git.mock.calls).toEqual([
      [['rev-parse', '--show-toplevel'], '/repo/apps/api'],
      [LS_FILES_ARGS, '/repo'],
    ]);
  });

  test('管理対象と未追跡の一覧を、重複を除いてパスの順に並べ直す', () => {
    const git = createFakeGit({
      'rev-parse': ok('/repo\n'),
      'ls-files': ok('b.test.ts\0c.ts\0b.test.ts\0a.ts\0'),
    });

    expect(listRepositoryFiles('/repo', git)).toEqual([
      'a.ts',
      'b.test.ts',
      'c.ts',
    ]);
  });

  test('gitが失敗すれば、コマンドとエラー出力を含む例外を投げる', () => {
    const git = createFakeGit({
      'rev-parse': {
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: not a git repository\n',
      },
    });

    expect(() => listRepositoryFiles('/not-a-repo', git)).toThrow(
      'Gitのファイル一覧を取得できませんでした(git rev-parse --show-toplevel): fatal: not a git repository',
    );
  });
});

const createOutput = () => {
  const written: string[] = [];
  return {
    write: (text: string) => {
      written.push(text);
    },
    text: () => written.join(''),
  };
};

const runEntryInProcess = (cwd: string, runGit: GitRunner) => {
  const stdout = createOutput();
  const stderr = createOutput();
  const exitCode = runTestNameCheckEntry({ cwd, runGit, stdout, stderr });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
};

const fakeGitListing = (paths: readonly string[]) =>
  createFakeGit({
    'rev-parse': ok('/repo\n'),
    'ls-files': ok(paths.map((path) => `${path}\0`).join('')),
  });

describe('runTestNameCheckEntry', () => {
  test('該当が無ければその旨を表示して0を返す', () => {
    const git = fakeGitListing([...WELL_NAMED_TEST_FILES, ...NON_TEST_FILES]);

    const { exitCode, stdout, stderr } = runEntryInProcess('/repo', git);

    expect(stdout).toBe(NO_MISNAMED_MESSAGE);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
  });

  test('品質ゲートの対象外と外部由来の配下にある命名規約外のファイルは検出しない', () => {
    const git = fakeGitListing([
      'mockups/src/routes/index.test.tsx',
      '.claude/hooks/hook.test.js',
      'docs/ai-extensions/sample.test.ts',
      '.kiro/settings/templates/sample.test.ts',
    ]);

    const { exitCode, stdout } = runEntryInProcess('/repo', git);

    expect(stdout).toBe(NO_MISNAMED_MESSAGE);
    expect(exitCode).toBe(0);
  });

  test('該当があればファイルと正しい命名規約を表示して1を返す', () => {
    const git = fakeGitListing([
      'apps/api/src/foo.test.ts',
      'mockups/src/ignored.test.ts',
      ...WELL_NAMED_TEST_FILES,
      'apps/client/src/bar.spec.tsx',
    ]);

    const { exitCode, stdout, stderr } = runEntryInProcess('/repo', git);

    expect(stdout).toBe('');
    expect(stderr).toBe(
      misnamedReportOf([
        'apps/api/src/foo.test.ts',
        'apps/client/src/bar.spec.tsx',
      ]),
    );
    expect(exitCode).toBe(1);
  });

  test('ファイル一覧を取得できなければ理由を表示して1を返す', () => {
    const git = createFakeGit({
      'rev-parse': {
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: not a git repository\n',
      },
    });

    const { exitCode, stdout, stderr } = runEntryInProcess('/tmp', git);

    expect(stdout).toBe('');
    expect(stderr).toBe(
      'Gitのファイル一覧を取得できませんでした(git rev-parse --show-toplevel): fatal: not a git repository\n',
    );
    expect(exitCode).toBe(1);
  });
});

let fixtureRoot = '';

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'check-test-names-test-'));
});

afterAll(async () => {
  if (fixtureRoot !== '') {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

const writeFixtureFiles = async (
  dir: string,
  files: Readonly<Record<string, string>>,
): Promise<void> => {
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }),
  );
};

const runGitIn = (cwd: string, args: readonly string[]): void => {
  const { exitCode, stderr } = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'ignore',
    stderr: 'pipe',
  });
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')}: ${stderr.toString()}`);
  }
};

const createGitRepository = async (
  files: Readonly<Record<string, string>>,
  stagedPaths: readonly string[] = [],
): Promise<string> => {
  const dir = await mkdtemp(join(fixtureRoot, 'repo-'));
  runGitIn(dir, ['init', '--quiet']);
  await writeFixtureFiles(dir, files);
  if (stagedPaths.length > 0) {
    runGitIn(dir, ['add', '--', ...stagedPaths]);
  }
  return dir;
};

const REPOSITORY_WITH_MISNAMED_FILES = {
  '.gitignore': 'ignored/\n',
  'ignored/generated.test.ts': '',
  'apps/api/src/staged.test.ts': '',
  'apps/api/src/untracked.test.ts': '',
  'apps/api/src/usecase.unit.test.ts': '',
  'apps/client/src/bar.spec.tsx': '',
  'e2e/login.e2e.test.ts': '',
  'mockups/src/routes/index.test.tsx': '',
  '.claude/hooks/hook.test.js': '',
  'docs/ai-extensions/sample.test.ts': '',
  '.kiro/settings/templates/sample.test.ts': '',
};

const MISNAMED_IN_REPOSITORY = [
  'apps/api/src/staged.test.ts',
  'apps/api/src/untracked.test.ts',
  'apps/client/src/bar.spec.tsx',
];

describe('実際のGitリポジトリでの検査', () => {
  test(
    'サブディレクトリから実行しても、作業ツリー全体の管理対象と未追跡のファイルから、無視対象・品質ゲートの対象外・外部由来を除いて検出する',
    async () => {
      const dir = await createGitRepository(REPOSITORY_WITH_MISNAMED_FILES, [
        'apps/api/src/staged.test.ts',
      ]);

      const { exitCode, stderr } = runEntryInProcess(
        join(dir, 'apps/api'),
        spawnGit,
      );

      expect(stderr).toBe(misnamedReportOf(MISNAMED_IN_REPOSITORY));
      expect(exitCode).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    'Gitの作業ツリーの外では理由を表示して1を返す',
    async () => {
      const dir = await mkdtemp(join(fixtureRoot, 'not-a-repo-'));

      const { exitCode, stderr } = runEntryInProcess(dir, spawnGit);

      expect(stderr).toStartWith(
        'Gitのファイル一覧を取得できませんでした(git rev-parse --show-toplevel): ',
      );
      expect(exitCode).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe('直接実行したときの入口', () => {
  const runEntry = (cwd: string) =>
    Bun.spawnSync([process.execPath, SCRIPT_PATH], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

  test(
    '命名規約に一致しないファイルがあれば、ファイルと正しい命名規約を表示して終了コード1で終える',
    async () => {
      const dir = await createGitRepository(REPOSITORY_WITH_MISNAMED_FILES);

      const { exitCode, stdout, stderr } = runEntry(dir);

      expect(stdout.toString()).toBe('');
      expect(stderr.toString()).toBe(misnamedReportOf(MISNAMED_IN_REPOSITORY));
      expect(exitCode).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    '命名規約に一致しないファイルが無ければ、その旨を表示して終了コード0で終える',
    async () => {
      const dir = await createGitRepository({
        'apps/api/src/usecase.unit.test.ts': '',
        'e2e/login.e2e.test.ts': '',
        'mockups/src/routes/index.test.tsx': '',
      });

      const { exitCode, stdout } = runEntry(dir);

      expect(stdout.toString()).toBe(NO_MISNAMED_MESSAGE);
      expect(exitCode).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );
});

interface BunTestConfig {
  readonly test: {
    readonly pathIgnorePatterns: readonly string[];
    readonly coveragePathIgnorePatterns: readonly string[];
  };
}

const readBunTestConfig = async (): Promise<BunTestConfig['test']> =>
  (
    Bun.TOML.parse(
      await readFile(join(REPO_ROOT, 'bunfig.toml'), 'utf8'),
    ) as BunTestConfig
  ).test;

const readScripts = async (
  packageJsonPath: string,
): Promise<Readonly<Record<string, string>>> => {
  const { scripts } = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };
  return scripts ?? {};
};

const PATH_IGNORE_OPTION =
  /--path-ignore-patterns(?:=|\s+)(?:'([^']*)'|"([^"]*)"|([^\s'"]+))/g;

const pathIgnorePatternsOf = (script: string): readonly string[] =>
  [...script.matchAll(PATH_IGNORE_OPTION)].map(
    ([, singleQuoted, doubleQuoted, bare]) =>
      singleQuoted ?? doubleQuoted ?? bare ?? '',
  );

// 除外パターンが命名パターンと同じか、ディレクトリを問わず同じファイル名に一致する(同等以上に広い)かを判定する
const covers = (ignorePattern: string, namingPattern: string): boolean =>
  ignorePattern === namingPattern ||
  ignorePattern === `**/${namingPattern.split('/').at(-1) ?? ''}`;

const NON_UNIT_NAMING_PATTERNS = [
  ...TEST_FILE_PATTERNS.browser,
  ...TEST_FILE_PATTERNS.worker,
  ...TEST_FILE_PATTERNS.e2e,
];

describe('書き写した除外パターンと単一定義の一致', () => {
  describe('単体テストの共通設定(bunfig.toml)', () => {
    test('除外パターンが、単体テスト以外の3種の命名パターンを同じか同等以上に広いパターンですべて除外する', async () => {
      const { pathIgnorePatterns } = await readBunTestConfig();

      const uncovered = NON_UNIT_NAMING_PATTERNS.filter(
        (namingPattern) =>
          !pathIgnorePatterns.some((ignorePattern) =>
            covers(ignorePattern, namingPattern),
          ),
      );

      expect(uncovered).toEqual([]);
    });

    test('除外パターンが単体テスト以外の命名パターンに対応するものだけで、単体テストの命名を除外しない', async () => {
      const { pathIgnorePatterns } = await readBunTestConfig();

      const unrelated = pathIgnorePatterns.filter(
        (ignorePattern) =>
          !NON_UNIT_NAMING_PATTERNS.some((namingPattern) =>
            covers(ignorePattern, namingPattern),
          ),
      );
      const excludingUnitTests = pathIgnorePatterns.filter((ignorePattern) =>
        TEST_FILE_PATTERNS.unit.some((namingPattern) =>
          covers(ignorePattern, namingPattern),
        ),
      );

      expect(pathIgnorePatterns.length).toBeGreaterThan(0);
      expect(unrelated).toEqual([]);
      expect(excludingUnitTests).toEqual([]);
    });

    test('カバレッジ除外パターンが自動生成コードのパターンと一致する', async () => {
      const { coveragePathIgnorePatterns } = await readBunTestConfig();

      expect(coveragePathIgnorePatterns.toSorted()).toEqual(
        GENERATED_CODE_PATTERNS.toSorted(),
      );
    });
  });

  describe('単体テストのコマンド', () => {
    test('除外パターンを指定するルートと作成済みの各アプリのtest:unitが、共通設定の除外パターンをすべて書き写している', async () => {
      const { pathIgnorePatterns } = await readBunTestConfig();
      const packageJsonPaths = [
        join(REPO_ROOT, 'package.json'),
        ...APPS.map(({ dir }) => join(REPO_ROOT, dir, 'package.json')).filter(
          (path) => existsSync(path),
        ),
      ];

      const checked = await Promise.all(
        packageJsonPaths.map(async (path) => {
          const written = pathIgnorePatternsOf(
            (await readScripts(path))['test:unit'] ?? '',
          );
          return {
            path,
            usesPathIgnorePatterns: written.length > 0,
            missing: pathIgnorePatterns.filter(
              (pattern) => !written.includes(pattern),
            ),
          };
        }),
      );
      const incomplete = checked.filter(
        ({ usesPathIgnorePatterns, missing }) =>
          usesPathIgnorePatterns && missing.length > 0,
      );

      expect(checked[0]?.usesPathIgnorePatterns).toBe(true);
      expect(incomplete).toEqual([]);
    });
  });

  describe('静的解析の基底設定(eslint.config.base.ts)', () => {
    test('対象外の一覧が自動生成コードのパターンをすべて含む', () => {
      const ignores = createBaseConfig({
        js,
        tseslint,
        prettierConfig,
        tsconfigRootDir: REPO_ROOT,
      }).find(({ name }) => name === 'base/ignores')?.ignores;

      expect(ignores).toBeArray();
      expect(
        GENERATED_CODE_PATTERNS.filter(
          (pattern) => !(ignores ?? []).includes(pattern),
        ),
      ).toEqual([]);
    });
  });

  describe('整形対象外の一覧(.prettierignore)', () => {
    const readPrettierIgnoreEntries = async (): Promise<readonly string[]> =>
      (await readFile(join(REPO_ROOT, '.prettierignore'), 'utf8'))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
        .map((line) => line.replace(/^\//, '').replace(/\/$/, ''));

    test.each([
      ['品質ゲートの対象外', QUALITY_GATE_EXCLUDED_DIRS],
      ['外部由来', EXTERNAL_SOURCE_DIRS],
      ['自動生成コード', GENERATED_CODE_PATTERNS],
    ])('%sの単一定義の値をすべて含む', async (_label, definition) => {
      const entries = await readPrettierIgnoreEntries();

      expect(definition.length).toBeGreaterThan(0);
      expect(definition.filter((value) => !entries.includes(value))).toEqual(
        [],
      );
    });
  });
});
