import js from '@eslint/js';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import { createBaseConfig } from '../../eslint.config.base.ts';

interface RestrictedPattern {
  readonly regex: string;
  readonly message: string;
}

const UNIT_TEST_FILES = ['**/*.unit.test.ts'];

// `.gitignore`形式のパターンはパスの途中の同名にも当たるため、パッケージ名の先頭からの一致を正規表現で表す
const RUNTIME_RESTRICTIONS: readonly RestrictedPattern[] = [
  {
    regex: '^(?:react|react-dom)(?:/.*)?$|^@tanstack/',
    message:
      '共用部品は画面部品に依存できません。画面の処理は共通部品(frontend-lib)に置いてください。',
  },
  {
    regex: '^hono(?:/.*)?$|^cloudflare:',
    message:
      '共用部品はWorkersの実行環境とHonoに依存できません。実行環境の処理は利用側アプリかバックエンドの共通ライブラリに置いてください。',
  },
  {
    regex: '^drizzle-orm(?:/.*)?$',
    message:
      '共用部品はデータベースに依存できません。データベースの処理はDBスキーマ定義か利用側アプリに置いてください。',
  },
  {
    regex: '^@milkdown/|^vue(?:/.*)?$',
    message:
      '共用部品はエディタに依存できません。エディタの処理は共通部品(frontend-lib)に置いてください。',
  },
  {
    regex: '^@sentry/|^@logtape/',
    message:
      '共用部品はログとエラートラッキングに依存できません。失敗は戻り値か例外で利用側へ返してください。',
  },
];

const NODE_AND_BUN_MESSAGE =
  '共用部品はNode.jsとBunだけにあるモジュールに依存できません。4つの実行環境に共通の標準APIを使ってください。';

const restrictImports = (
  patterns: readonly RestrictedPattern[],
): Linter.RulesRecord => ({
  'no-restricted-imports': ['error', { patterns: [...patterns] }],
});

const config: Linter.Config[] = [
  ...createBaseConfig({
    js,
    tseslint,
    prettierConfig,
    tsconfigRootDir: import.meta.dirname,
  }),
  {
    name: 'common-lib/type-position-imports',
    files: ['**/*.ts'],
    rules: {
      // 型の位置のimport()は読み込みの境界の規則と単体テストの走査に現れないため、import文に限る
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { disallowTypeAnnotations: true },
      ],
    },
  },
  {
    name: 'common-lib/runtime-boundary',
    files: ['**/*.ts'],
    ignores: ['*.config.ts', ...UNIT_TEST_FILES],
    rules: restrictImports([
      ...RUNTIME_RESTRICTIONS,
      { regex: '^node:|^bun(?::.*)?$', message: NODE_AND_BUN_MESSAGE },
    ]),
  },
  {
    name: 'common-lib/runtime-boundary/unit-tests',
    files: UNIT_TEST_FILES,
    rules: restrictImports([
      ...RUNTIME_RESTRICTIONS,
      {
        regex: '^node:|^bun(?::(?!test$).*)?$',
        message: `${NODE_AND_BUN_MESSAGE}単体テストはbun:testだけを読み込めます。`,
      },
    ]),
  },
  prettierConfig,
];

export default config;
