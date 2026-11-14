import js from '@eslint/js';
import type { Linter } from 'eslint';
import prettierConfig from 'eslint-config-prettier/flat';
import tseslint from 'typescript-eslint';

import {
  APP_SOURCE_RESTRICTION,
  BACKEND_LAYER_PATTERNS,
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
              group: ['**/db/**', 'drizzle-orm*'],
              message:
                '共有コードのcoreはDBスキーマとDrizzle ORMに依存できません。DBの型(接続・一括の書き込みの文など)が必要な契約はworkersに置いてください。',
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
const BUN_LOADED_PRESENTATION_PATTERNS = [
  BUN_LOADED_RESTRICTION,
  ...BACKEND_LAYER_PATTERNS.infrastructureAndPresentation,
];

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
        { patterns: BUN_LOADED_PRESENTATION_PATTERNS },
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

// ESLintは解決後のパスではなくimportの文字列で照合するため、相対パスの深さや書き方によらずidentityのディレクトリを全て禁じ、共有ディレクトリとDBスキーマの利用者の部分だけを許し直す
const IDENTITY_LAYER_GROUP = [
  '**/identity',
  '**/identity/**',
  '!**/lib/**',
  '!**/common-lib/**',
  '!**/db/**',
];

// 管理者の認証が利用者のモジュール無しで認証部品を再利用できるよう、認証部品の各層から利用者のモジュールを型も含めて読み込ませない
const IDENTITY_FROM_AUTH_RESTRICTION = {
  group: IDENTITY_LAYER_GROUP,
  message:
    '認証部品(auth)は利用者のモジュール(identity)に依存できません。利用者に固有の処理はidentityの層に置き、認証部品のポートを実装してください。',
};

// 同じファイルに当たる後の設定のno-restricted-importsは層の規則のオプションを置き換えるため、その層の層の規則のパターンを含め直す
const AUTH_LAYER_RULES: Linter.Config[] = [
  {
    name: 'api/auth/domain',
    files: ['src/domain/auth/**'],
    patterns: BACKEND_LAYER_PATTERNS.domain,
  },
  {
    name: 'api/auth/application',
    files: ['src/application/auth/**'],
    patterns: BACKEND_LAYER_PATTERNS.application,
  },
  {
    name: 'api/auth/infrastructure',
    files: ['src/infrastructure/auth/**'],
    patterns: BACKEND_LAYER_PATTERNS.infrastructureAndPresentation,
  },
  {
    // GraphQLのスキーマモジュールが読み込むため、Bunで読み込む規則も含め直す
    name: 'api/auth/graphql-inputs',
    files: ['src/presentation/graphql/auth-inputs.ts'],
    patterns: BUN_LOADED_PRESENTATION_PATTERNS,
  },
].map(({ name, files, patterns }) => ({
  name,
  files,
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: [...patterns, IDENTITY_FROM_AUTH_RESTRICTION] },
    ],
  },
}));

// 管理者の業務処理が利用者の業務処理の変更に左右されないよう、管理者の各層から利用者のモジュールを型も含めて読み込ませない
const IDENTITY_FROM_ADMIN_RESTRICTION = {
  group: IDENTITY_LAYER_GROUP,
  message:
    '管理者のモジュール(admin)は利用者のモジュール(identity)に依存できません。主体に依存しない処理は認証部品(auth)に置いてください。',
};

// 管理者の束縛が利用者のモジュールの束縛と登録箇所の変更に左右されないよう、管理者のモジュールの合成から利用者の合成を読み込ませない
const IDENTITY_COMPOSITION_RESTRICTION = {
  group: ['./identity-*', '**/composition/identity-*'],
  message:
    '管理者のモジュールの合成(admin-module)は利用者のモジュールの合成(identity-*)に依存できません。共通の束縛は認証部品の識別子(AUTH_TYPES)から得てください。',
};

// 同じファイルに当たる後の設定のno-restricted-importsは層の規則のオプションを置き換えるため、その層の層の規則のパターンを含め直す。GraphQLのスキーマモジュールはBunで読み込む規則の後に置く
const ADMIN_LAYER_RULES: Linter.Config[] = [
  {
    name: 'api/admin/domain',
    files: ['src/domain/admin/**'],
    patterns: BACKEND_LAYER_PATTERNS.domain,
  },
  {
    name: 'api/admin/application',
    files: ['src/application/admin/**'],
    patterns: BACKEND_LAYER_PATTERNS.application,
  },
  {
    name: 'api/admin/infrastructure-and-presentation',
    files: [
      'src/infrastructure/admin/**',
      'src/presentation/graphql/admin-guard.ts',
      'src/presentation/graphql/admin-guard.*.test.ts',
      'src/presentation/graphql/modules/admin/**/*.worker.test.ts',
    ],
    patterns: BACKEND_LAYER_PATTERNS.infrastructureAndPresentation,
  },
  {
    name: 'api/admin/composition',
    files: [
      'src/composition/admin-module.ts',
      'src/composition/admin-module.*.test.ts',
    ],
    patterns: [IDENTITY_COMPOSITION_RESTRICTION],
  },
  {
    name: 'api/admin/graphql-modules',
    files: ['src/presentation/graphql/modules/admin/**'],
    ignores: ['src/presentation/graphql/modules/admin/**/*.worker.test.ts'],
    patterns: BUN_LOADED_PRESENTATION_PATTERNS,
  },
].map(({ patterns, ...config }) => ({
  ...config,
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: [...patterns, IDENTITY_FROM_ADMIN_RESTRICTION] },
    ],
  },
}));

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 問い合わせのインフラ層が利用者・管理者の一括の書き込みに文を渡す口だけを許す。importの文字列で照合するため、同じ層の隣のディレクトリへの相対パスと、層の名前から書いたパスの両方を表す
const INQUIRY_ALLOWED_FOREIGN_FILES = [
  'admin/audit-log-statements',
  'identity/user-lifecycle-sync-handler',
];

// gitignore形式の否定は除外した親ディレクトリの下のファイルを含め直せないため、共有ディレクトリ・DBスキーマと許すファイルを除いたidentity・adminのディレクトリを正規表現で表す
const INQUIRY_FOREIGN_MODULE_REGEX = [
  '^',
  '(?!.*(?:^|/)(?:lib|common-lib|db)/)',
  `(?!(?:\\.\\./)+(?:infrastructure/)?(?:${INQUIRY_ALLOWED_FOREIGN_FILES.map(escapeRegExp).join('|')})(?:\\.ts)?$)`,
  '(?:.*/)?(?:identity|admin)(?:/|$)',
].join('');

// 問い合わせの業務処理が利用者・管理者の業務処理の変更に左右されないよう、問い合わせの各層から両者のモジュールを型も含めて読み込ませない
const IDENTITY_AND_ADMIN_FROM_INQUIRY_RESTRICTION = {
  regex: INQUIRY_FOREIGN_MODULE_REGEX,
  message:
    '問い合わせのモジュール(inquiry)は利用者(identity)・管理者(admin)のモジュールに依存できません。共通ライブラリのcoreの契約と識別子を使い、一括の書き込みの文はaudit-log-statements.ts・user-lifecycle-sync-handler.tsだけから得てください。',
};

// 同じファイルに当たる後の設定のno-restricted-importsは層の規則のオプションを置き換えるため、その層の層の規則のパターンを含め直す。GraphQLのスキーマモジュールはBunで読み込む規則の後に置く
const INQUIRY_LAYER_RULES: Linter.Config[] = [
  {
    name: 'api/inquiry/domain',
    files: ['src/domain/inquiry/**'],
    patterns: BACKEND_LAYER_PATTERNS.domain,
  },
  {
    name: 'api/inquiry/application',
    files: ['src/application/inquiry/**'],
    patterns: BACKEND_LAYER_PATTERNS.application,
  },
  {
    name: 'api/inquiry/infrastructure-and-presentation',
    files: [
      'src/infrastructure/inquiry/**',
      'src/presentation/graphql/modules/inquiry/**/*.worker.test.ts',
    ],
    patterns: BACKEND_LAYER_PATTERNS.infrastructureAndPresentation,
  },
  {
    name: 'api/inquiry/graphql-modules',
    files: ['src/presentation/graphql/modules/inquiry/**'],
    ignores: ['src/presentation/graphql/modules/inquiry/**/*.worker.test.ts'],
    patterns: BUN_LOADED_PRESENTATION_PATTERNS,
  },
].map(({ patterns, ...config }) => ({
  ...config,
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: [...patterns, IDENTITY_AND_ADMIN_FROM_INQUIRY_RESTRICTION] },
    ],
  },
}));

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

// 共用部品の静的解析は検査担当の共用部品自身が受け持つため、配置先を重ねて検査しない
const config: Linter.Config[] = [
  {
    name: 'api/ignores',
    ignores: ['common-lib/'],
  },
  ...createBaseConfig({
    js,
    tseslint,
    prettierConfig,
    tsconfigRootDir: import.meta.dirname,
  }),
  ...createBackendLayerRules('api'),
  ...AUTH_LAYER_RULES,
  ...REACT_FORBIDDEN_RULES,
  ...BUN_LOADED_GRAPHQL_RULES,
  ...ADMIN_LAYER_RULES,
  ...INQUIRY_LAYER_RULES,
  ...GRAPHQL_SCRIPT_RULES,
  ...SHARED_DIRECTORY_RULES,
];

export default config;
