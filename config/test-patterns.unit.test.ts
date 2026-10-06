import { describe, expect, expectTypeOf, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COVERAGE_THRESHOLD_PERCENT,
  GENERATED_CODE_PATTERNS,
  TEST_FILE_PATTERNS,
  TEST_LIKE_FILE_PATTERN,
  type TestKind,
} from './test-patterns.ts';

const matchesAny = (patterns: readonly string[], path: string): boolean =>
  patterns.some((pattern) => new Bun.Glob(pattern).match(path));

describe('TEST_FILE_PATTERNS', () => {
  test('4種のテストの命名パターンを持つ', () => {
    expect(TEST_FILE_PATTERNS).toEqual({
      unit: ['**/*.unit.test.ts'],
      browser: ['**/*.browser.test.{ts,tsx}'],
      worker: ['**/*.worker.test.{ts,tsx}'],
      e2e: ['e2e/**/*.e2e.test.ts'],
    });
  });

  const examples: readonly (readonly [TestKind, string])[] = [
    ['unit', 'apps/api/src/usecase.unit.test.ts'],
    ['unit', 'config.unit.test.ts'],
    ['browser', 'apps/client/src/button.browser.test.tsx'],
    ['browser', 'apps/frontend-lib/utilities/format.browser.test.ts'],
    ['worker', 'apps/event/src/queue.worker.test.ts'],
    ['worker', 'apps/api/src/route.worker.test.tsx'],
    ['e2e', 'e2e/login.e2e.test.ts'],
    ['e2e', 'e2e/flows/vote.e2e.test.ts'],
  ];

  test.each(examples)(
    '%sのファイル%sはその種別のパターンだけに一致する',
    (kind, path) => {
      const matchedKinds = Object.entries(TEST_FILE_PATTERNS)
        .filter(([, patterns]) => matchesAny(patterns, path))
        .map(([matchedKind]) => matchedKind);

      expect(matchedKinds).toEqual([kind]);
    },
  );

  test('種別を含まないテストファイルはどのパターンにも一致しない', () => {
    const allPatterns = Object.values(TEST_FILE_PATTERNS).flat();

    expect(matchesAny(allPatterns, 'apps/api/src/foo.test.ts')).toBe(false);
    expect(matchesAny(allPatterns, 'apps/api/src/foo.e2e.test.ts')).toBe(false);
  });

  test('型として変更不可である', () => {
    expectTypeOf(TEST_FILE_PATTERNS).toEqualTypeOf<
      Readonly<Record<TestKind, readonly string[]>>
    >();
  });
});

describe('TEST_LIKE_FILE_PATTERN', () => {
  test.each([
    'foo.test.ts',
    'bar.spec.tsx',
    'baz_test.mjs',
    'qux_spec.cts',
    'x.unit.test.ts',
    'e2e/login.e2e.test.ts',
    'apps/client/src/button.browser.test.tsx',
    'apps/api/src/legacy.test.js',
    'apps/api/src/legacy.spec.jsx',
    'apps/api/src/legacy_test.cjs',
  ])('テストランナーがテストとみなす名前%sに一致する', (path) => {
    expect(TEST_LIKE_FILE_PATTERN.test(path)).toBe(true);
  });

  test.each([
    'foo.ts',
    'test-utils.ts',
    'contest.ts',
    'latest.spec.md',
    'fixtures.test.json',
    'apps/api/test/helpers.ts',
  ])('テストではない名前%sに一致しない', (path) => {
    expect(TEST_LIKE_FILE_PATTERN.test(path)).toBe(false);
  });

  test('繰り返し照合しても結果が変わらない', () => {
    expect(TEST_LIKE_FILE_PATTERN.global).toBe(false);
    expect(TEST_LIKE_FILE_PATTERN.sticky).toBe(false);
  });
});

describe('GENERATED_CODE_PATTERNS', () => {
  test('自動生成コードのパターンを持つ', () => {
    expect(GENERATED_CODE_PATTERNS).toEqual(['**/*.gen.ts', '**/generated/**']);
  });

  test.each([
    'apps/client/src/routeTree.gen.ts',
    'apps/api/src/generated/graphql.ts',
    'apps/frontend-lib/generated/schema/types.ts',
  ])('自動生成コード%sに一致する', (path) => {
    expect(matchesAny(GENERATED_CODE_PATTERNS, path)).toBe(true);
  });

  test('手書きのコードに一致しない', () => {
    expect(
      matchesAny(GENERATED_CODE_PATTERNS, 'apps/api/src/generate.ts'),
    ).toBe(false);
  });

  test('型として変更不可の配列である', () => {
    expectTypeOf(GENERATED_CODE_PATTERNS).toEqualTypeOf<readonly string[]>();
  });
});

describe('COVERAGE_THRESHOLD_PERCENT', () => {
  test('カバレッジ閾値を80%とする', () => {
    expect(COVERAGE_THRESHOLD_PERCENT).toBe(80);
  });

  test('型はリテラル80である', () => {
    expectTypeOf(COVERAGE_THRESHOLD_PERCENT).toEqualTypeOf<80>();
  });

  test('単体テストの共通設定(bunfig.toml)に書き写した閾値が同じ割合である', () => {
    const bunfig = Bun.TOML.parse(
      readFileSync(join(import.meta.dir, '..', 'bunfig.toml'), 'utf8'),
    ) as { readonly test: { readonly coverageThreshold: unknown } };

    expect(bunfig.test.coverageThreshold).toBe(
      COVERAGE_THRESHOLD_PERCENT / 100,
    );
  });
});

test('定義モジュールは他のモジュールをimportしない', () => {
  const source = readFileSync(
    join(import.meta.dir, 'test-patterns.ts'),
    'utf8',
  );

  expect(source).not.toMatch(/^\s*import\s/m);
  expect(source).not.toMatch(/\sfrom\s+['"]/);
  expect(source).not.toMatch(/\b(?:require|import)\s*\(/);
});
