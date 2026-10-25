import js from '@eslint/js';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import { createBaseConfig } from '../../eslint.config.base.ts';

const RUNTIME_MESSAGE =
  'この位置のコードはWorkersの実行環境とHonoに依存できません。依存は外側の層か共有コードのworkersに置いてください。';

const LAYER_RULES: Linter.Config[] = [
  {
    name: 'event/layers/domain',
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
    name: 'event/layers/application',
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
    name: 'event/layers/infrastructure-and-presentation',
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

// 共有ディレクトリの静的解析は検査担当のapiが受け持つため、配置先を重ねて検査しない
const config: Linter.Config[] = [
  {
    name: 'event/ignores',
    ignores: ['db/', 'lib/'],
  },
  ...createBaseConfig({
    js,
    tseslint,
    prettierConfig,
    tsconfigRootDir: import.meta.dirname,
  }),
  ...LAYER_RULES,
];

export default config;
