import type { Linter } from 'eslint';

export const RUNTIME_MESSAGE =
  'この位置のコードはWorkersの実行環境とHonoに依存できません。依存は外側の層か共有コードのworkersに置いてください。';

// 共有コードとDBスキーマは複数のアプリに配置されるため、配置先のアプリの層に依存すると他のアプリで解決できない
export const APP_SOURCE_RESTRICTION = {
  group: ['**/src/**'],
  message:
    '共有ディレクトリは利用側アプリのsrcに依存できません。アプリ固有の型や値は合成ルートから渡してください。',
};

// `.gitignore`形式の`react`はパスの途中の`react`という名前にも当たるため、パッケージ名の先頭からの一致を正規表現で表す
export const REACT_RESTRICTION = {
  regex: '^(?:react|react-dom)(?:/.*)?$|^@react-email/',
  message:
    'Reactと@react-email/*はメールの描画とテンプレートの位置(eventのsrc/infrastructure/email/renderingとtemplates)だけが読み込めます。描画は合成ルートで束縛した描画処理を経由してください。',
};

type RestrictedImportPattern = Readonly<{
  group: readonly string[];
  message: string;
}>;

// 層の規則を同じファイルに当たる後の設定で置き換えるとき、その層の禁止を含め直せるよう、層ごとのパターンを公開する
export const BACKEND_LAYER_PATTERNS = Object.freeze({
  domain: [
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
  application: [
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
  infrastructureAndPresentation: [
    {
      group: ['**/composition/**'],
      message: 'インフラ層とプレゼンテーション層は合成ルートに依存できません。',
    },
  ],
} as const satisfies Record<string, readonly RestrictedImportPattern[]>);

const restrictedPatterns = (
  patterns: readonly RestrictedImportPattern[],
): Linter.RuleEntry => [
  'error',
  {
    patterns: patterns.map(({ group, message }) => ({
      group: [...group],
      message,
    })),
  },
];

// バックエンドのアプリ(api・event)のsrcの4層の依存方向を、ファイルの位置ごとの禁止importで強制する
export function createBackendLayerRules(appName: string): Linter.Config[] {
  return [
    {
      name: `${appName}/layers/domain`,
      files: ['src/domain/**'],
      rules: {
        'no-restricted-imports': restrictedPatterns(
          BACKEND_LAYER_PATTERNS.domain,
        ),
      },
    },
    {
      name: `${appName}/layers/application`,
      files: ['src/application/**'],
      rules: {
        'no-restricted-imports': restrictedPatterns(
          BACKEND_LAYER_PATTERNS.application,
        ),
      },
    },
    {
      name: `${appName}/layers/infrastructure-and-presentation`,
      files: ['src/infrastructure/**', 'src/presentation/**'],
      rules: {
        'no-restricted-imports': restrictedPatterns(
          BACKEND_LAYER_PATTERNS.infrastructureAndPresentation,
        ),
      },
    },
  ];
}
