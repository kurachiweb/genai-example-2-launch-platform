import type { Linter } from 'eslint';

export const RUNTIME_MESSAGE =
  'この位置のコードはWorkersの実行環境とHonoに依存できません。依存は外側の層か共有コードのworkersに置いてください。';

// 共有コードとDBスキーマは複数のアプリに配置されるため、配置先のアプリの層に依存すると他のアプリで解決できない
export const APP_SOURCE_RESTRICTION = {
  group: ['**/src/**'],
  message:
    '共有ディレクトリは利用側アプリのsrcに依存できません。アプリ固有の型や値は合成ルートから渡してください。',
};

// バックエンドのアプリ(api・event)のsrcの4層の依存方向を、ファイルの位置ごとの禁止importで強制する
export function createBackendLayerRules(appName: string): Linter.Config[] {
  return [
    {
      name: `${appName}/layers/domain`,
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
      name: `${appName}/layers/application`,
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
      name: `${appName}/layers/infrastructure-and-presentation`,
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
}
