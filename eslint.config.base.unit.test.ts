import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import js from '@eslint/js';
import { ESLint, type Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import ts from 'typescript';
import tseslint from 'typescript-eslint';

import {
  type BaseConfigDependencies,
  createBaseConfig,
} from './eslint.config.base.ts';

const TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: 'ES2024',
    module: 'ESNext',
    moduleResolution: 'bundler',
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
  include: ['**/*.ts'],
};

const RESTRICTED_GLOBAL_CALLS = {
  isNaN: { call: 'isNaN(1)', expectedHint: 'Number.isNaN' },
  isFinite: { call: 'isFinite(1)', expectedHint: 'Number.isFinite' },
  parseInt: { call: "parseInt('1', 10)", expectedHint: 'Number.parseInt' },
  parseFloat: { call: "parseFloat('1')", expectedHint: 'Number.parseFloat' },
  escape: { call: "escape('a')", expectedHint: 'encodeURIComponent' },
  unescape: { call: "unescape('a')", expectedHint: 'decodeURIComponent' },
} as const;

const TYPE_AWARE_VIOLATIONS = [
  "export const tail = 'abc'.substr(1);",
  'Promise.resolve(1);',
  '',
].join('\n');

const FORMATTING_ONLY_DIFFERENCES = [
  'const values = [1, 2]',
  'export const first = values',
  '[0]',
  'export const label =    "abc"',
  '        .toUpperCase()',
  '',
].join('\n');

const COMMON_RULE_VIOLATIONS = {
  'no-console': "console.log('x');\n",
  'prefer-object-has-own':
    "const source = { a: 1 };\nexport const has = Object.prototype.hasOwnProperty.call(source, 'a');\n",
  'prefer-exponentiation-operator': 'export const power = Math.pow(2, 3);\n',
  'prefer-object-spread':
    'const source = { a: 1 };\nexport const copy = Object.assign({}, source);\n',
} as const;

const FIXTURE_FILES: Readonly<Record<string, string>> = {
  'tsconfig.json': JSON.stringify(TSCONFIG),
  'compliant.ts': "export const valid = Number.isNaN(Number('1'));\n",
  'type-aware.ts': TYPE_AWARE_VIOLATIONS,
  'vite.config.ts': TYPE_AWARE_VIOLATIONS,
  'formatting.ts': FORMATTING_ONLY_DIFFERENCES,
  ...Object.fromEntries(
    Object.entries(RESTRICTED_GLOBAL_CALLS).map(([name, { call }]) => [
      `global-${name}.ts`,
      `export const result = ${call};\n`,
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(COMMON_RULE_VIOLATIONS).map(([ruleId, code]) => [
      `rule-${ruleId}.ts`,
      code,
    ]),
  ),
};

const LINTED_FILES = Object.keys(FIXTURE_FILES).filter((name) =>
  name.endsWith('.ts'),
);

let fixtureDir = '';
let eslint: ESLint;
let messagesByFile: ReadonlyMap<string, readonly Linter.LintMessage[]> =
  new Map();

const messagesOf = (fileName: string): readonly Linter.LintMessage[] =>
  messagesByFile.get(join(fixtureDir, fileName)) ?? [];

const ruleIdsOf = (fileName: string): readonly (string | null)[] =>
  messagesOf(fileName).map(({ ruleId }) => ruleId);

const createDependencies = (
  tsconfigRootDir: string,
): BaseConfigDependencies => ({
  js,
  tseslint,
  prettierConfig,
  tsconfigRootDir,
});

beforeAll(
  async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'eslint-base-test-'));
    await Promise.all(
      Object.entries(FIXTURE_FILES).map(([name, content]) =>
        writeFile(join(fixtureDir, name), content),
      ),
    );
    eslint = new ESLint({
      cwd: fixtureDir,
      overrideConfigFile: true,
      overrideConfig: createBaseConfig(createDependencies(fixtureDir)),
    });
    const results = await eslint.lintFiles(LINTED_FILES);
    messagesByFile = new Map(
      results.map(({ filePath, messages }) => [filePath, messages]),
    );
  },
  { timeout: 60_000 },
);

afterAll(async () => {
  if (fixtureDir !== '') {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

describe('createBaseConfig', () => {
  test('規則に沿ったコードは違反にならない', () => {
    expect(messagesOf('compliant.ts')).toEqual([]);
  });

  test.each(Object.entries(RESTRICTED_GLOBAL_CALLS))(
    'グローバルの%sの使用が置き換え先を示す違反になる',
    (name, { expectedHint }) => {
      const violations = messagesOf(`global-${name}.ts`).filter(
        ({ ruleId }) => ruleId === 'no-restricted-globals',
      );

      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain(expectedHint);
    },
  );

  test('非推奨のString.prototype.substrの使用が違反になる', () => {
    expect(ruleIdsOf('type-aware.ts')).toContain(
      '@typescript-eslint/no-deprecated',
    );
  });

  test('型情報付きの厳格な規則が有効になる', () => {
    expect(ruleIdsOf('type-aware.ts')).toContain(
      '@typescript-eslint/no-floating-promises',
    );
  });

  test.each(Object.keys(COMMON_RULE_VIOLATIONS))(
    '共通規則の%sが違反になる',
    (ruleId) => {
      expect(ruleIdsOf(`rule-${ruleId}.ts`)).toContain(ruleId);
    },
  );

  test('セミコロン・引用符・インデント・改行位置だけが異なるコードは違反にならない', () => {
    expect(messagesOf('formatting.ts')).toEqual([]);
  });

  test('整形と衝突する規則がすべて無効になる', async () => {
    const config = (await eslint.calculateConfigForFile(
      join(fixtureDir, 'formatting.ts'),
    )) as Linter.Config;
    const severities = Object.keys(prettierConfig.rules)
      .map((ruleId) => config.rules?.[ruleId])
      .filter((entry) => entry !== undefined)
      .map((entry) => (Array.isArray(entry) ? entry[0] : entry));

    expect(severities.length).toBeGreaterThan(0);
    expect(
      severities.every((severity) => severity === 0 || severity === 'off'),
    ).toBe(true);
  });

  test('設定ファイルでは型情報付きの規則が無効になる', () => {
    expect(ruleIdsOf('vite.config.ts')).toEqual([]);
  });

  test.each([
    'dist/index.ts',
    'apps/client/dist/index.ts',
    '.output/server/index.ts',
    '.tanstack/tmp/route.ts',
    '.wrangler/tmp/worker.ts',
    'coverage/unit/index.ts',
    'storybook-static/main.ts',
    'src/routeTree.gen.ts',
    'src/generated/graphql.ts',
  ])('%sを検査対象外にする', async (path) => {
    expect(await eslint.isPathIgnored(path)).toBe(true);
  });

  test('ビルド成果物や自動生成コード以外のファイルは検査対象にする', async () => {
    expect(await eslint.isPathIgnored('src/index.ts')).toBe(false);
  });

  test('推奨規則・型情報付きの厳格な規則の順に並べ、整形と衝突する規則の無効化を最後に置く', () => {
    const dependencies = createDependencies(fixtureDir);
    const config = createBaseConfig(dependencies);
    const strictConfigs: readonly unknown[] =
      dependencies.tseslint.configs.strictTypeChecked;
    const recommendedIndex = config.indexOf(
      dependencies.js.configs.recommended,
    );
    const strictIndexes = strictConfigs.map((entry) =>
      (config as readonly unknown[]).indexOf(entry),
    );

    expect(recommendedIndex).toBeGreaterThanOrEqual(0);
    expect(strictIndexes.every((index) => index > recommendedIndex)).toBe(true);
    expect(config.at(-1)).toBe(dependencies.prettierConfig);
  });
});

const isTypeOnlyImport = (node: ts.ImportDeclaration): boolean =>
  node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;

const isModuleCall = ({ expression }: ts.CallExpression): boolean =>
  expression.kind === ts.SyntaxKind.ImportKeyword ||
  (ts.isIdentifier(expression) && expression.text === 'require');

const isValueModuleReference = (node: ts.Node): boolean => {
  if (ts.isImportDeclaration(node)) {
    return !isTypeOnlyImport(node);
  }
  if (ts.isExportDeclaration(node)) {
    return node.moduleSpecifier !== undefined && !node.isTypeOnly;
  }
  if (ts.isImportEqualsDeclaration(node)) {
    return !node.isTypeOnly;
  }
  return ts.isCallExpression(node) && isModuleCall(node);
};

const collectNodes = (
  node: ts.Node,
  predicate: (node: ts.Node) => boolean,
): readonly string[] => [
  ...(predicate(node) ? [node.getText()] : []),
  ...node.getChildren().flatMap((child) => collectNodes(child, predicate)),
];

const parse = (source: string): ts.SourceFile =>
  ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);

const valueModuleReferencesOf = (source: string): readonly string[] =>
  collectNodes(parse(source), isValueModuleReference);

describe('値のモジュール参照の検出', () => {
  test.each([
    "import js from '@eslint/js';",
    "import { type Linter } from 'eslint';",
    "import './side-effect.ts';",
    "export { createBaseConfig } from './base.ts';",
    "export * from './base.ts';",
    "import base = require('./base.ts');",
    "const loaded = await import('./base.ts');",
    "const loaded = require('./base.ts');",
  ])('%sを値の参照として検出する', (source) => {
    expect(valueModuleReferencesOf(source)).toHaveLength(1);
  });

  test.each([
    "import type js from '@eslint/js';",
    "import type { Linter } from 'eslint';",
    "export type { Linter } from 'eslint';",
    'export const value = 1;',
  ])('%sを値の参照として検出しない', (source) => {
    expect(valueModuleReferencesOf(source)).toEqual([]);
  });
});

describe('eslint.config.base.ts', () => {
  test('npmパッケージを型としてのみ参照し、値のimportを持たない', async () => {
    const source = await readFile(
      join(import.meta.dirname, 'eslint.config.base.ts'),
      'utf8',
    );
    const typeOnlyImports = collectNodes(
      parse(source),
      (node) => ts.isImportDeclaration(node) && isTypeOnlyImport(node),
    );

    expect(typeOnlyImports.length).toBeGreaterThan(0);
    expect(valueModuleReferencesOf(source)).toEqual([]);
  });
});
