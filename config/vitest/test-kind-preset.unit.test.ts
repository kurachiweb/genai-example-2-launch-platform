import { describe, expect, expectTypeOf, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { valueModuleReferencesOf } from '../../test-support/module-references.ts';
import {
  COVERAGE_THRESHOLD_PERCENT,
  GENERATED_CODE_PATTERNS,
  TEST_FILE_PATTERNS,
} from '../test-patterns.ts';
import { APPS } from '../workspace-layout.ts';
import { browserTestPreset } from './browser.ts';
import {
  type CoveragePreset,
  createTestKindPreset,
  type TestKindPreset,
} from './test-kind-preset.ts';
import { workerTestPreset } from './worker.ts';

const CONFIG_DIR = resolve(import.meta.dir, '..');
const REPO_ROOT = resolve(CONFIG_DIR, '..');

const presets: readonly (readonly [string, TestKindPreset])[] = [
  ['browserTestPreset', browserTestPreset],
  ['workerTestPreset', workerTestPreset],
];

const matchesAny = (patterns: readonly string[], path: string): boolean =>
  patterns.some((pattern) => new Bun.Glob(pattern).match(path));

const isGitIgnored = (path: string): boolean =>
  Bun.spawnSync(['git', 'check-ignore', '--no-index', '--quiet', path], {
    cwd: REPO_ROOT,
  }).exitCode === 0;

describe.each(presets)('%s', (_name, preset) => {
  test('対象が0件でも成功させる', () => {
    expect(preset.passWithNoTests).toBe(true);
  });

  test('行と関数の閾値を単一定義の値でファイルごとに判定する', () => {
    expect(preset.coverage.thresholds).toStrictEqual({
      lines: COVERAGE_THRESHOLD_PERCENT,
      functions: COVERAGE_THRESHOLD_PERCENT,
      perFile: true,
    });
  });

  test('計測の有効化を指定せず、計測を指定した実行だけで閾値を判定させる', () => {
    expect(Object.hasOwn(preset.coverage, 'enabled')).toBe(false);
    expect(Object.hasOwn(preset, 'enabled')).toBe(false);
  });

  test('4種すべてのテストファイルと自動生成コードを単一定義から除外する', () => {
    expect(preset.coverage.exclude).toEqual([
      ...TEST_FILE_PATTERNS.unit,
      ...TEST_FILE_PATTERNS.browser,
      ...TEST_FILE_PATTERNS.worker,
      ...TEST_FILE_PATTERNS.e2e,
      ...GENERATED_CODE_PATTERNS,
    ]);
  });

  test.each([
    'src/usecase.unit.test.ts',
    'src/button.browser.test.tsx',
    'src/format.browser.test.ts',
    'src/route.worker.test.ts',
    'src/queue.worker.test.tsx',
    'e2e/login.e2e.test.ts',
    'src/routeTree.gen.ts',
    'src/generated/graphql.ts',
  ])('テストファイル・自動生成コード%sを分母から外す', (path) => {
    expect(matchesAny(preset.coverage.exclude, path)).toBe(true);
  });

  test.each(['src/usecase.ts', 'src/button.tsx', 'src/generate.ts'])(
    'プロダクションコード%sを分母から外さない',
    (path) => {
      expect(matchesAny(preset.coverage.exclude, path)).toBe(false);
    },
  );

  test.each(APPS.map(({ dir }) => dir))(
    '%sでの出力先がGit管理外である',
    (appDir) => {
      expect(
        isGitIgnored(
          join(appDir, preset.coverage.reportsDirectory, 'lcov.info'),
        ),
      ).toBe(true);
    },
  );
});

test('種別ごとの出力先が単体テストの出力先を含めて互いに重ならない', () => {
  const bunfig = Bun.TOML.parse(
    readFileSync(join(REPO_ROOT, 'bunfig.toml'), 'utf8'),
  ) as { readonly test: { readonly coverageDir: string } };
  const reportsDirectories = [
    bunfig.test.coverageDir,
    browserTestPreset.coverage.reportsDirectory,
    workerTestPreset.coverage.reportsDirectory,
  ];

  expect(new Set(reportsDirectories).size).toBe(reportsDirectories.length);
});

describe('プリセットの型', () => {
  test('Vitestの設定に取り込めるよう、プロパティは変更不可のまま配列だけを変更可能にする', () => {
    expectTypeOf<CoveragePreset>().toEqualTypeOf<{
      readonly provider: 'v8' | 'istanbul';
      readonly reportsDirectory: string;
      readonly reporter: ('text' | 'lcov')[];
      readonly thresholds: {
        readonly lines: number;
        readonly functions: number;
        readonly perFile: true;
      };
      readonly exclude: string[];
    }>();
    expectTypeOf<TestKindPreset>().toEqualTypeOf<{
      readonly include: string[];
      readonly passWithNoTests: true;
      readonly coverage: CoveragePreset;
    }>();
  });
});

describe('プリセットの配列', () => {
  test.each(presets)(
    '%sは単一定義の配列を共有せず自分のコピーを持つ',
    (_name, preset) => {
      const kindPatterns = Object.values(TEST_FILE_PATTERNS);

      expect(kindPatterns).not.toContain(preset.include);
      expect(kindPatterns).not.toContain(preset.coverage.exclude);
      expect(preset.coverage.exclude).not.toBe(GENERATED_CODE_PATTERNS);
    },
  );

  test('ブラウザテストとWorkers統合テストのプリセットは配列を共有しない', () => {
    expect(browserTestPreset.include).not.toBe(workerTestPreset.include);
    expect(browserTestPreset.coverage.exclude).not.toBe(
      workerTestPreset.coverage.exclude,
    );
    expect(browserTestPreset.coverage.reporter).not.toBe(
      workerTestPreset.coverage.reporter,
    );
  });

  test('プリセットの配列を変更しても単一定義と他のプリセットに届かない', () => {
    const singleDefinitions = structuredClone({
      TEST_FILE_PATTERNS,
      GENERATED_CODE_PATTERNS,
    });
    const preset = createTestKindPreset('browser', 'v8');

    preset.include.push('**/*.extra.test.ts');
    preset.coverage.exclude.push('**/extra/**');
    preset.coverage.reporter.push('text');

    expect({ TEST_FILE_PATTERNS, GENERATED_CODE_PATTERNS }).toEqual(
      singleDefinitions,
    );
    expect(createTestKindPreset('browser', 'v8')).toEqual(browserTestPreset);
    expect(browserTestPreset.include).toEqual([...TEST_FILE_PATTERNS.browser]);
  });
});

describe('config/vitest配下のモジュール', () => {
  const modulePaths = [
    ...new Bun.Glob('*.ts').scanSync({ cwd: import.meta.dir }),
  ]
    .filter((file) => !file.endsWith('.test.ts'))
    .toSorted()
    .map((file) => join(import.meta.dir, file));

  test('プリセットと共通定義のモジュールがある', () => {
    expect(modulePaths.map((path) => path.split(sep).at(-1))).toEqual([
      'browser.ts',
      'test-kind-preset.ts',
      'worker.ts',
    ]);
  });

  test.each(modulePaths)(
    '%sはnpmパッケージを値として参照せず、config配下のモジュールだけを値として参照する',
    (modulePath) => {
      const source = readFileSync(modulePath, 'utf8');
      const specifiers = valueModuleReferencesOf(source).map(
        (reference) => /['"]([^'"]+)['"]/.exec(reference)?.[1],
      );

      for (const specifier of specifiers) {
        expect(specifier).toMatch(/^\.\.?\//);
        expect(
          resolve(dirname(modulePath), specifier ?? '').startsWith(
            CONFIG_DIR + sep,
          ),
        ).toBe(true);
      }
    },
  );
});
