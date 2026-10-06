import type js from '@eslint/js';
import type { Linter } from 'eslint';
import type tseslint from 'typescript-eslint';

export interface BaseConfigDependencies {
  readonly js: typeof js;
  readonly tseslint: typeof tseslint;
  readonly prettierConfig: Linter.Config;
  readonly tsconfigRootDir: string;
}

const BUILD_OUTPUT_PATTERNS = [
  '**/dist/**',
  '**/.output/**',
  '**/.tanstack/**',
  '**/.wrangler/**',
  '**/coverage/**',
  '**/storybook-static/**',
] as const;

// アプリから読み込まれる基底設定は値のimportを持てないため、config/test-patterns.tsのGENERATED_CODE_PATTERNSを書き写している
const GENERATED_CODE_PATTERNS = ['**/*.gen.ts', '**/generated/**'] as const;

// `wrangler types`の出力ファイル名は変えられずGENERATED_CODE_PATTERNSの命名契約に従わないため、個別に除外する
const WRANGLER_GENERATED_TYPES = ['**/worker-configuration.d.ts'] as const;

const NUMBER_STATIC_METHOD_GLOBALS = [
  'isNaN',
  'isFinite',
  'parseInt',
  'parseFloat',
] as const;

const RESTRICTED_GLOBALS = [
  ...NUMBER_STATIC_METHOD_GLOBALS.map((name) => ({
    name,
    message: `グローバルの${name}ではなく、Number.${name}を使ってください。`,
  })),
  {
    name: 'escape',
    message: '廃止予定のescapeではなく、encodeURIComponentを使ってください。',
  },
  {
    name: 'unescape',
    message: '廃止予定のunescapeではなく、decodeURIComponentを使ってください。',
  },
];

const COMMON_RULES: Linter.RulesRecord = {
  '@typescript-eslint/no-deprecated': 'error',
  'no-restricted-globals': ['error', ...RESTRICTED_GLOBALS],
  'prefer-object-has-own': 'error',
  'prefer-exponentiation-operator': 'error',
  'prefer-object-spread': 'error',
  'no-console': 'error',
};

export function createBaseConfig({
  js,
  tseslint,
  prettierConfig,
  tsconfigRootDir,
}: BaseConfigDependencies): Linter.Config[] {
  return [
    {
      name: 'base/ignores',
      ignores: [
        ...BUILD_OUTPUT_PATTERNS,
        ...GENERATED_CODE_PATTERNS,
        ...WRANGLER_GENERATED_TYPES,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      name: 'base/type-checked-parser-options',
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
    },
    { name: 'base/common-rules', rules: COMMON_RULES },
    {
      ...tseslint.configs.disableTypeChecked,
      // 設定ファイルはアプリのコードと異なりBun上で読み込まれ、アプリのtsconfigが含まない型(`import.meta.dirname`など)を使うため、型情報付きの検査から外す
      name: 'base/config-files',
      files: ['**/*.config.ts'],
    },
    prettierConfig,
  ];
}
