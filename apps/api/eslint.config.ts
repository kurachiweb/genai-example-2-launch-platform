import js from '@eslint/js';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import {
  APP_SOURCE_RESTRICTION,
  createBackendLayerRules,
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

const config: Linter.Config[] = [
  ...createBaseConfig({
    js,
    tseslint,
    prettierConfig,
    tsconfigRootDir: import.meta.dirname,
  }),
  ...createBackendLayerRules('api'),
  ...BUN_LOADED_GRAPHQL_RULES,
  ...SHARED_DIRECTORY_RULES,
];

export default config;
