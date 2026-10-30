import { describe, expect, test } from 'bun:test';

const APP_DIR_URL = new URL('../', import.meta.url);

const RUNTIME_PACKAGES = [
  'unified',
  'remark-parse',
  'remark-gfm',
  'remark-cjk-friendly',
  'remark-cjk-friendly-gfm-strikethrough',
  'remark-rehype',
  'rehype-sanitize',
  'rehype-stringify',
  'hast-util-to-text',
  'zod',
] as const;

// bun:sqliteは全文検索の検索式がFTS5の構文として成立することを単体テストで確かめるために使う
const UNIT_TEST_ONLY_MODULES = ['bun:test', 'bun:sqlite'] as const;

const UNIT_TEST_FILE_PATTERN = /\.unit\.test\.ts$/;

const SOURCE_GLOB = '**/*.{ts,tsx}';

const NON_SOURCE_PATH_PATTERNS = [
  /^node_modules\//,
  /^coverage\//,
  // 直下の設定ファイルは品質ツールと基底設定を読み込み、共用部品の実行時のコードに含まれない
  /^[^/]+\.config\.ts$/,
] as const;

const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

const transpiler = new Bun.Transpiler({ loader: 'ts' });

// Bunの走査は型だけの読み込みを消すため、型の修飾子を外して値の読み込みとして走査させる
const exposeTypeOnlyReferences = (source: string): string =>
  source
    .replace(
      /^(\s*(?:import|export))\s+type\b(?=\s*[{*]|\s+[\w$]+\s+from\b)/gm,
      '$1',
    )
    .replace(/([{,]\s*)type\s+(?=[\w$]+\s*(?:[,}]|as\b))/g, '$1');

const isPathSpecifier = (specifier: string): boolean =>
  specifier.startsWith('.') || specifier.startsWith('/');

const packageNameOf = (specifier: string): string => {
  const segments = specifier.split('/');
  return (
    specifier.startsWith('@') ? segments.slice(0, 2) : segments.slice(0, 1)
  ).join('/');
};

const isAllowedSpecifier = (path: string, specifier: string): boolean => {
  if (isPathSpecifier(specifier)) {
    return new URL(specifier, new URL(path, APP_DIR_URL)).href.startsWith(
      APP_DIR_URL.href,
    );
  }
  if (
    UNIT_TEST_FILE_PATTERN.test(path) &&
    (UNIT_TEST_ONLY_MODULES as readonly string[]).includes(specifier)
  ) {
    return true;
  }
  return (RUNTIME_PACKAGES as readonly string[]).includes(
    packageNameOf(specifier),
  );
};

const findImportViolations = (
  path: string,
  source: string,
): readonly string[] =>
  transpiler
    .scanImports(exposeTypeOnlyReferences(source))
    .map(({ path: specifier }) => specifier)
    .filter((specifier) => !isAllowedSpecifier(path, specifier));

const listSourcePaths = async (): Promise<readonly string[]> => {
  const paths = await Array.fromAsync(
    new Bun.Glob(SOURCE_GLOB).scan({ cwd: Bun.fileURLToPath(APP_DIR_URL) }),
  );
  return paths
    .filter((path) =>
      NON_SOURCE_PATH_PATTERNS.every((pattern) => !pattern.test(path)),
    )
    .toSorted();
};

interface PackageJson {
  readonly dependencies?: Readonly<Record<string, string>>;
}

const readPackageJson = async (): Promise<PackageJson> =>
  (await Bun.file(new URL('package.json', APP_DIR_URL)).json()) as PackageJson;

describe('共用部品の読み込みの境界', () => {
  test('全ソースの読み込みが共用部品の内側と許可したパッケージだけを指す', async () => {
    const paths = await listSourcePaths();
    const violations = Object.fromEntries(
      (
        await Promise.all(
          paths.map(
            async (path) =>
              [
                path,
                findImportViolations(
                  path,
                  await Bun.file(new URL(path, APP_DIR_URL)).text(),
                ),
              ] as const,
          ),
        )
      ).filter(([, specifiers]) => specifiers.length > 0),
    );

    expect(paths).toContain('config/import-boundary.unit.test.ts');
    expect(violations).toEqual({});
  });

  test('許可したパッケージが共用部品の実行時の依存の宣言と一致する', async () => {
    const { dependencies } = await readPackageJson();

    expect(Object.keys(dependencies ?? {}).toSorted()).toEqual(
      [...RUNTIME_PACKAGES].toSorted(),
    );
  });

  test('実行時の依存の版を範囲指定なしで固定する', async () => {
    const { dependencies } = await readPackageJson();

    expect(
      Object.entries(dependencies ?? {}).filter(
        ([, version]) => !EXACT_VERSION_PATTERN.test(version),
      ),
    ).toEqual([]);
  });

  test.each([
    ['markdown/sample.ts', "import { useState } from 'react';"],
    ['markdown/sample.ts', "import type { Root } from 'hast';"],
    ['markdown/sample.ts', "import { type Context } from 'hono';"],
    ['markdown/sample.ts', "export { env } from 'cloudflare:workers';"],
    ['markdown/sample.ts', "export type * from '@sentry/core';"],
    ['markdown/sample.ts', "export type * as Hast from 'hast';"],
    ['markdown/sample.ts', "import type Mdast from 'mdast';"],
    ['markdown/sample.ts', "export type {\n  Element,\n} from 'hast';"],
    ['markdown/sample.ts', "import type from 'react';"],
    ['markdown/sample.ts', "import { getLogger } from '@logtape/logtape';"],
    ['markdown/sample.ts', "import { readFile } from 'node:fs/promises';"],
    ['markdown/sample.ts', "import { file } from 'bun';"],
    ['markdown/sample.ts', "import { sql } from 'drizzle-orm';"],
    ['markdown/sample.ts', "const crepe = await import('@milkdown/crepe');"],
    [
      'markdown/sample.ts',
      "import { cn } from '../../frontend-lib/utilities/cn.ts';",
    ],
    ['markdown/sample.ts', "export * from '../../../config/test-patterns.ts';"],
    ['text/graphemes.ts', "import { describe } from 'bun:test';"],
    ['search/search-terms.ts', "import { Database } from 'bun:sqlite';"],
    ['search/sample.unit.test.ts', "import { serve } from 'bun';"],
  ])('%sの「%s」を許可外の読み込みとして検出する', (path, source) => {
    expect(findImportViolations(path, source)).toHaveLength(1);
  });

  test.each([
    ['markdown/sample.ts', "import { unified } from 'unified';"],
    ['markdown/sample.ts', "import remarkGfm from 'remark-gfm';"],
    ['markdown/sample.ts', "import type { Schema } from 'rehype-sanitize';"],
    ['validation/sample.ts', "import { z } from 'zod';"],
    [
      'markdown/sample.ts',
      "import { countGraphemes } from '../text/graphemes.ts';",
    ],
    ['markdown/sample.ts', "export * from './plugins/heading-ids.ts';"],
    ['text/graphemes.unit.test.ts', "import { describe } from 'bun:test';"],
    [
      'search/search-terms.unit.test.ts',
      "import { Database } from 'bun:sqlite';",
    ],
    ['markdown/sample.ts', 'const sample = "import { Hono } from \'hono\'";'],
    ['markdown/sample.ts', "export type LinkRelToken = 'a' | 'b';"],
    ['markdown/sample.ts', 'export type Foo<T> = readonly T[];'],
    ['markdown/sample.ts', "export type Bar =\n  | 'a'\n  | 'b';"],
  ])('%sの「%s」を許可した読み込みとして扱う', (path, source) => {
    expect(findImportViolations(path, source)).toEqual([]);
  });
});
