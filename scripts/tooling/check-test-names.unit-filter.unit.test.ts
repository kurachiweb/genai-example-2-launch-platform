import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { TEST_FILE_PATTERNS } from '../../config/test-patterns.ts';
import { findMisnamedTestFiles } from './check-test-names.ts';

const REPO_ROOT = join(import.meta.dirname, '../..');
const SPAWN_TIMEOUT_MS = 30_000;
const REPORT_FILE_NAME = 'report.xml';

// Bunがテストファイルとみなし、かつパスに単体テストのフィルタを含み得る名前を、拡張子・区切り文字・ディレクトリ名の違いで並べる
const CANDIDATE_PATHS = [
  'src/clamp.unit.test.ts',
  'src/button.unit.test.tsx',
  'src/legacy.unit.test.js',
  'src/legacy.unit.test.jsx',
  'src/module.unit.test.mts',
  'src/module.unit.test.mjs',
  'src/module.unit.test.cts',
  'src/module.unit.test.cjs',
  'src/helper_unit.test.ts',
  'src/unit.test.ts',
  'src/unit.test.spec.ts',
  'src/unit.test/helper.test.ts',
  'src/unit.test/helper.spec.ts',
  'src/unit.test/helper_test.ts',
  'src/unit.test/helper_spec.ts',
];

const UNIT_TEST_GLOBS = TEST_FILE_PATTERNS.unit.map(
  (pattern) => new Bun.Glob(pattern),
);

const followsUnitTestNaming = (path: string): boolean =>
  UNIT_TEST_GLOBS.some((glob) => glob.match(path));

const readRootUnitTestFilter = async (): Promise<string> => {
  const { scripts } = JSON.parse(
    await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
  ) as { readonly scripts?: Readonly<Record<string, string>> };
  return scripts?.['test:unit']?.trim().split(/\s+/).at(-1) ?? '';
};

let fixtureRoot = '';

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'check-test-names-filter-'));
});

afterAll(async () => {
  if (fixtureRoot !== '') {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

const writeCandidates = async (dir: string): Promise<void> => {
  await Promise.all(
    CANDIDATE_PATHS.map(async (path) => {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(
        join(dir, path),
        `import { test } from 'bun:test';\ntest(${JSON.stringify(path)}, () => {});\n`,
      );
    }),
  );
};

// テスト名を各ファイルのパスにしてあるため、JUnit形式の結果からテスト名を集めると実行されたファイルの一覧になる
const runUnitTestFilter = async (
  dir: string,
  filter: string,
): Promise<{ readonly exitCode: number; readonly ran: readonly string[] }> => {
  const reportPath = join(dir, REPORT_FILE_NAME);
  const { exitCode } = Bun.spawnSync(
    [
      process.execPath,
      'test',
      '--reporter=junit',
      `--reporter-outfile=${reportPath}`,
      filter,
    ],
    { cwd: dir, stdout: 'ignore', stderr: 'ignore' },
  );
  const report = await readFile(reportPath, 'utf8');
  const ran = [...report.matchAll(/<testcase name="([^"]*)"/g)].map(
    ([, name]) => name ?? '',
  );
  return { exitCode, ran: ran.toSorted() };
};

describe('単体テストのコマンドがパスの部分一致で拾うファイル', () => {
  test(
    '単体テストの命名に一致しないのに実行されるファイルは、すべて命名検査が命名規約外として検出する',
    async () => {
      const filter = await readRootUnitTestFilter();
      const dir = await mkdtemp(join(fixtureRoot, 'candidates-'));
      await writeCandidates(dir);

      const { exitCode, ran } = await runUnitTestFilter(dir, filter);
      const ranWithoutUnitNaming = ran.filter(
        (path) => !followsUnitTestNaming(path),
      );

      expect(filter).toBe('unit.test');
      expect(exitCode).toBe(0);
      expect(ran).toContain('src/clamp.unit.test.ts');
      expect(ranWithoutUnitNaming).toContain('src/button.unit.test.tsx');
      expect(
        findMisnamedTestFiles(ranWithoutUnitNaming).map(({ path }) => path),
      ).toEqual(ranWithoutUnitNaming);
    },
    SPAWN_TIMEOUT_MS,
  );
});
