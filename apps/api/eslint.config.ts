import js from '@eslint/js';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import {
  APP_SOURCE_RESTRICTION,
  createBackendLayerRules,
  REACT_RESTRICTION,
  RUNTIME_MESSAGE,
} from '../../config/eslint/backend-layers.ts';
import { createBaseConfig } from '../../eslint.config.base.ts';

const DB_WORKER_TEST_FILES = 'db/**/*.worker.test.{ts,tsx}';

const DB_TABLE_DEFINITION_RESTRICTION = {
  name: 'drizzle-orm/sqlite-core',
  importNames: ['sqliteTable', 'sqliteTableCreator'],
  message:
    '列名をスネークケースへ変換するため、テーブルはsnakeCase.tableで定義してください。',
};

const DB_SHARED_DIRECTORY_RESTRICTION = {
  group: ['**/lib/**'],
  message:
    'drizzle-kitが配置元でスキーマを読み込むため、DBスキーマは他の共有ディレクトリに依存できません。',
};

// 共有ディレクトリの静的解析は検査担当のapiだけが受け持つため、共有コードとDBスキーマの規則はapiにだけ置く
const SHARED_DIRECTORY_RULES: Linter.Config[] = [
  {
    name: 'api/shared/backend-lib-core',
    files: ['lib/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/workers/**', 'cloudflare:*'],
              message: RUNTIME_MESSAGE,
            },
            {
              group: ['**/db/**'],
              message:
                '共有コードのcoreはDBスキーマに依存できません。DBの型が必要な契約はworkersに置いてください。',
            },
            APP_SOURCE_RESTRICTION,
          ],
        },
      ],
      // モジュール登録の契約がHonoのアプリの型を参照するため、実行時に残らない型だけのimportは許す
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['hono'],
              message: RUNTIME_MESSAGE,
              allowTypeImports: true,
            },
            REACT_RESTRICTION,
          ],
        },
      ],
    },
  },
  {
    name: 'api/shared/backend-lib-workers',
    files: ['lib/workers/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [APP_SOURCE_RESTRICTION] },
      ],
    },
  },
  {
    name: 'api/shared/db',
    files: ['db/**'],
    ignores: [DB_WORKER_TEST_FILES],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [DB_TABLE_DEFINITION_RESTRICTION],
          patterns: [
            DB_SHARED_DIRECTORY_RESTRICTION,
            APP_SOURCE_RESTRICTION,
            {
              group: ['hono', 'cloudflare:*'],
              message: 'DBスキーマは実行環境とHonoに依存できません。',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'api/shared/db-worker-tests',
    files: [DB_WORKER_TEST_FILES],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [DB_TABLE_DEFINITION_RESTRICTION],
          patterns: [
            DB_SHARED_DIRECTORY_RESTRICTION,
            APP_SOURCE_RESTRICTION,
            // Workers統合テストはD1のバインディングをworkerdの実行環境から受け取るため、cloudflare:*だけを許す
            {
              group: ['hono'],
              message: 'DBのWorkers統合テストはHonoに依存できません。',
            },
          ],
        },
      ],
    },
  },
];

const BUN_LOADED_RESTRICTION = {
  group: ['cloudflare:*', '@sentry/*', '**/infrastructure/**'],
  message:
    'GraphQLの生成コマンドと単体テストがBunで読み込むため、このファイルはWorkersの実行環境・Sentry・インフラ層に依存できません。',
};

// 同じファイルに当たる後の設定のno-restricted-importsは層の規則のオプションを置き換えるため、プレゼンテーション層の合成ルートの禁止を含め直す
const BUN_LOADED_GRAPHQL_RULES: Linter.Config[] = [
  {
    name: 'api/graphql/bun-loaded-presentation',
    files: [
      'src/presentation/graphql/modules/**',
      'src/presentation/graphql/schema-module.ts',
      'src/presentation/graphql/schema-composer.ts',
      'src/presentation/graphql/platform-type-defs.ts',
      'src/presentation/graphql/date-time-scalar.ts',
      'src/presentation/graphql/query-limits.ts',
      'src/presentation/graphql/error-codes.ts',
    ],
    // Workers統合テストはBunが読み込まず、D1などのバインディングをworkerdの実行環境から受け取るため、層の規則だけを当てる
    ignores: ['src/presentation/graphql/modules/**/*.worker.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            BUN_LOADED_RESTRICTION,
            {
              group: ['**/composition/**'],
              message:
                'インフラ層とプレゼンテーション層は合成ルートに依存できません。',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'api/graphql/bun-loaded-registry',
    files: ['src/composition/graphql-modules.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [BUN_LOADED_RESTRICTION] },
      ],
    },
  },
];

const SCRIPT_READABLE_SOURCE_FILES = [
  'composition/graphql-modules',
  'presentation/graphql/schema-module',
  'presentation/graphql/schema-composer',
  'presentation/graphql/platform-type-defs',
  'presentation/graphql/date-time-scalar',
  'presentation/graphql/query-limits',
  'presentation/graphql/error-codes',
  'presentation/gateway/gateway-headers',
];

const SCRIPT_READABLE_SOURCE_DIRS = ['presentation/graphql/modules'];

const OPERATION_ALLOWLIST_SOURCE = 'presentation/graphql/operation-allowlist';

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// gitignore形式の否定では除外した親ディレクトリの下のファイルを含め直せないため、指定のファイル・ディレクトリ以外のsrcを正規表現で表す
const UNREADABLE_SOURCE_REGEX = `/src/(?!(?:${[
  ...[...SCRIPT_READABLE_SOURCE_FILES, OPERATION_ALLOWLIST_SOURCE].map(
    (file) => `${escapeRegExp(file)}(?:\\.ts)?$`,
  ),
  ...SCRIPT_READABLE_SOURCE_DIRS.map((dir) => `${escapeRegExp(dir)}/`),
].join('|')}))`;

// 生成・検査のスクリプトはBunで実行され、単体テストのカバレッジの分母も読み込んだファイルで決まるため、srcのうちBunで読み込める指定のファイルだけを読み込ませる
const GRAPHQL_SCRIPT_RULES: Linter.Config[] = [
  {
    name: 'api/graphql/scripts',
    files: ['scripts/graphql/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            BUN_LOADED_RESTRICTION,
            {
              regex: UNREADABLE_SOURCE_REGEX,
              message:
                'GraphQLの生成・検査のスクリプトは、srcのうちGraphQLの登録箇所・スキーマの合成・上限・エラーコード・ゲートウェイのヘッダーのファイルだけを読み込めます。',
            },
          ],
        },
      ],
      // 許可リストの型はスクリプトの出力の形を決めるため読み込めるが、実体はWorkersの実行時の処理を引き込むため読み込ませない
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                `**/src/${OPERATION_ALLOWLIST_SOURCE}`,
                `**/src/${OPERATION_ALLOWLIST_SOURCE}.ts`,
              ],
              allowTypeImports: true,
              message:
                'GraphQLの生成・検査のスクリプトは、許可リストのモジュールから型だけを読み込めます。',
            },
            REACT_RESTRICTION,
          ],
        },
      ],
    },
  },
  // 層の規則のno-restricted-importsのオプションを置き換えないよう、srcからscriptsへの禁止は別の規則で行う
  {
    name: 'api/source/no-scripts',
    files: ['src/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/scripts/**'],
              message:
                'srcは生成・検査のスクリプトに依存できません。共有する処理はsrcに置き、スクリプトから読み込んでください。',
            },
            REACT_RESTRICTION,
          ],
        },
      ],
    },
  },
];

// ReactとReact Emailはeventのメールの描画だけが使うため、apiでは型だけのimportも含めて全体で禁止する。後に当たる@typescript-eslint/no-restricted-importsの設定はこのオプションを置き換えるため、それぞれREACT_RESTRICTIONを含め直す
const REACT_FORBIDDEN_RULES: Linter.Config[] = [
  {
    name: 'api/react/forbidden',
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [REACT_RESTRICTION] },
      ],
    },
  },
];

const config: Linter.Config[] = [
  ...createBaseConfig({
    js,
    tseslint,
    prettierConfig,
    tsconfigRootDir: import.meta.dirname,
  }),
  ...createBackendLayerRules('api'),
  ...REACT_FORBIDDEN_RULES,
  ...BUN_LOADED_GRAPHQL_RULES,
  ...GRAPHQL_SCRIPT_RULES,
  ...SHARED_DIRECTORY_RULES,
];

export default config;
