import js from '@eslint/js';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import { createBaseConfig } from '../../eslint.config.base.ts';

const RUNTIME_MESSAGE =
  'この位置のコードはWorkersの実行環境とHonoに依存できません。依存は外側の層か共有コードのworkersに置いてください。';

const LAYER_RULES: Linter.Config[] = [
  {
    name: 'api/layers/domain',
    files: ['src/domain/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/application/**',
                '**/infrastructure/**',
                '**/presentation/**',
                '**/composition/**',
              ],
              message: 'ドメイン層は外側の層に依存できません。',
            },
            {
              group: [
                'hono',
                'drizzle-orm*',
                'cloudflare:*',
                '**/lib/workers/**',
                '**/db/**',
              ],
              message:
                'ドメイン層は実行環境・Hono・Drizzle ORM・DBスキーマに依存できません。',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'api/layers/application',
    files: ['src/application/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/infrastructure/**',
                '**/presentation/**',
                '**/composition/**',
              ],
              message: 'アプリケーション層は外側の層に依存できません。',
            },
            {
              group: ['hono', 'cloudflare:*', '**/lib/workers/**'],
              message: RUNTIME_MESSAGE,
            },
            {
              group: ['**/db/client*'],
              message:
                'アプリケーション層はDBの接続を作れません。接続はインフラ層で扱ってください。',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'api/layers/infrastructure-and-presentation',
    files: ['src/infrastructure/**', 'src/presentation/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
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
];

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
    name: 'api/shared/db',
    files: ['db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'drizzle-orm/sqlite-core',
              importNames: ['sqliteTable', 'sqliteTableCreator'],
              message:
                '列名をスネークケースへ変換するため、テーブルはsnakeCase.tableで定義してください。',
            },
          ],
          patterns: [
            {
              group: ['**/lib/**'],
              message:
                'drizzle-kitが配置元でスキーマを読み込むため、DBスキーマは他の共有ディレクトリに依存できません。',
            },
            {
              group: ['hono', 'cloudflare:*'],
              message: 'DBスキーマは実行環境とHonoに依存できません。',
            },
          ],
        },
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
  ...LAYER_RULES,
  ...SHARED_DIRECTORY_RULES,
];

export default config;
