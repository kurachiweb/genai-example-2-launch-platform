import type { Linter } from 'eslint';

// 各プラグインが公開する型は規則の型の出どころ(@typescript-eslint/utilsなど)が異なりESLint.Pluginへ代入できないため、推奨設定を持つことだけを型で求め、形は実行時に確かめる
export interface PluginWithConfigs {
  readonly configs?: unknown;
}

export interface FrontendLintDependencies {
  readonly eslintReact: PluginWithConfigs;
  readonly reactHooks: PluginWithConfigs;
  readonly jsxA11y: PluginWithConfigs;
  readonly tanstackQuery: PluginWithConfigs;
  readonly tanstackRouter: PluginWithConfigs;
  readonly storybook: PluginWithConfigs;
}

type RestrictedImportPattern = Readonly<Record<string, unknown>>;

const RAW_HTML_PROPERTY = '/^(?:inner|outer)HTML$/';

const RAW_HTML_MESSAGE =
  '生のHTMLを挿入できません。要素はJSXで組み立て、文字列はtextContentで設定してください。';

// 識別子のプロパティはname、文字列リテラルの計算プロパティはvalueに名前を持つため、両方の形を検出する
const namedProperty = (attribute: string, pattern: string): string =>
  `:matches([${attribute}.name=${pattern}], [${attribute}.value=${pattern}])`;

const RAW_HTML_SYNTAX_RESTRICTIONS = [
  {
    selector: `AssignmentExpression > MemberExpression.left${namedProperty('property', RAW_HTML_PROPERTY)}`,
    message: RAW_HTML_MESSAGE,
  },
  {
    selector: `CallExpression > MemberExpression.callee${namedProperty('property', "'insertAdjacentHTML'")}`,
    message: RAW_HTML_MESSAGE,
  },
  // JSXを使わないcreateElementの呼び出しは危険なHTMLの属性の規則が検出しないため、第2引数の属性のオブジェクトを調べる
  {
    selector: `CallExpression:matches([callee.name='createElement'], [callee.property.name='createElement']) > ObjectExpression.arguments:nth-child(2) > Property${namedProperty('key', "'dangerouslySetInnerHTML'")}`,
    message: RAW_HTML_MESSAGE,
  },
];

// 共通部品の4つのディレクトリはどの深さからでも親をたどって参照するため、相対パスの先頭の`../`の繰り返しで行き先のディレクトリを判定する
const relativeDirectoryPattern = (directory: string): string =>
  `^(?:\\.\\./)+${directory}/`;

const RUNTIME_PACKAGE_RESTRICTION: RestrictedImportPattern = {
  regex:
    '^(?:react|react-dom|react-hook-form)(?:/.*)?$|^@hookform/|^@tanstack/|^cloudflare:|^@sentry/(?:cloudflare|tanstackstart-react)(?:/.*)?$',
  allowTypeImports: true,
  message:
    'Bunの単体テストで読み込むため、純粋な関数とサーバーの部品はReact・フォームのライブラリ(react-hook-form・@hookform)・TanStack・Workersの実行環境・Sentryの実行時の値に依存できません。型だけを読み込み、フォームのライブラリの値を使う処理は画面部品に置いてください。',
};

// テストは検査の対象の振る舞いを本物のライブラリで動かすため、実行時の値の制限を外す
const PURE_POSITION_TEST_FILES = [
  'utilities/**/*.test.ts',
  'utilities/**/*.test.tsx',
  'server/**/*.test.ts',
  'server/**/*.test.tsx',
];

const APP_SOURCE_RESTRICTION: RestrictedImportPattern = {
  regex: relativeDirectoryPattern('src'),
  message:
    '共通部品は利用側アプリのsrcに依存できません。アプリ固有の値は登録箇所から渡してください。',
};

const reverseDirectionRestriction = (
  position: string,
  directories: readonly string[],
): RestrictedImportPattern => ({
  regex: `^(?:\\.\\./)+(?:${directories.join('|')})/`,
  message: `${position}は、依存の向き(utilities ← server ← start ← components)に反して${directories.join('・')}に依存できません。`,
});

const SERVER_ONLY_FILE_RESTRICTION: RestrictedImportPattern = {
  regex: '^\\.{1,2}/.*\\.server(?:\\.tsx?)?$',
  message:
    '画面部品はサーバー専用ファイル(*.server.ts)に依存できません。同じディレクトリの同型の関数(createIsomorphicFn)を経由してください。',
};

const SERVER_VALUE_RESTRICTION: RestrictedImportPattern = {
  regex: relativeDirectoryPattern('server'),
  allowTypeImports: true,
  message:
    '画面部品はサーバーの部品から型だけを読み込めます。実行時の処理はstartの同型の関数を経由してください。',
};

// ブラウザのSentryのSDKは初期化の時に動的importで読み込む。ブラウザのバンドルに入るファイルが同じパッケージの実行時の値を静的に読み込むと、動的importが別のチャンクに分かれずSDK全体が主バンドルに入る
const BROWSER_SENTRY_RESTRICTION: RestrictedImportPattern = {
  regex: '^@sentry/tanstackstart-react(?:/.*)?$',
  allowTypeImports: true,
  message:
    'ブラウザのバンドルに入るファイルはSentryのTanStack Start版の実行時の値を静的に読み込めません。サーバーの処理はサーバー専用ファイル(*.server.ts)に置いて同型の関数(createIsomorphicFn)のサーバーの分岐から読み込み、ブラウザの処理は動的importで読み込んでください。',
};

const COMPOSITION_TO_ROUTES_RESTRICTION: RestrictedImportPattern = {
  regex: relativeDirectoryPattern('routes'),
  message:
    '登録箇所(src/composition)はルート(src/routes)に依存できません。ルートから登録箇所を読み込んでください。',
};

const ZOD_ENTRY_FILE = 'utilities/validation/zod.ts';

// ZodはZodObjectを作る時にnew Functionを試し、CSPの下のブラウザでは例外を捕捉しても違反として報告されるため、試行を止める設定を済ませた部品からだけ値を読み込ませる
const ZOD_VALUE_RESTRICTION: RestrictedImportPattern = {
  regex: '^zod(?:/.*)?$',
  allowTypeImports: true,
  message: `Zodの値はJITを止める設定を済ませた共通部品(${ZOD_ENTRY_FILE})のzから読み込んでください。型だけの読み込みはそのまま書けます。`,
};

const restrictImports = (
  patterns: readonly RestrictedImportPattern[],
): Linter.RuleEntry => ['error', { patterns }];

// 同じ規則を設定する後の設定は前の設定の選択肢を置き換えるため、型を区別する読み込みの制限には常にZodの制限を含める
const restrictValueImports = (
  patterns: readonly RestrictedImportPattern[],
): Linter.RuleEntry => restrictImports([ZOD_VALUE_RESTRICTION, ...patterns]);

const PURE_VALUE_RESTRICTIONS: readonly RestrictedImportPattern[] = [
  RUNTIME_PACKAGE_RESTRICTION,
];

const ZOD_ENTRY_RULE: Linter.Config = {
  name: 'frontend/zod-entry',
  files: ['**/*.ts', '**/*.tsx'],
  rules: {
    '@typescript-eslint/no-restricted-imports': restrictValueImports([]),
  },
};

const ZOD_ENTRY_FILE_RULE: Linter.Config = {
  name: 'frontend/zod-entry/file',
  files: [ZOD_ENTRY_FILE],
  rules: {
    '@typescript-eslint/no-restricted-imports': restrictImports(
      PURE_VALUE_RESTRICTIONS,
    ),
  },
};

const DEPENDENCY_DIRECTION_RULES: Linter.Config[] = [
  {
    name: 'frontend/direction/utilities',
    files: ['utilities/**'],
    rules: {
      'no-restricted-imports': restrictImports([
        reverseDirectionRestriction('純粋な関数', [
          'server',
          'start',
          'components',
        ]),
        APP_SOURCE_RESTRICTION,
      ]),
      '@typescript-eslint/no-restricted-imports': restrictValueImports(
        PURE_VALUE_RESTRICTIONS,
      ),
    },
  },
  {
    name: 'frontend/direction/server',
    files: ['server/**'],
    rules: {
      'no-restricted-imports': restrictImports([
        reverseDirectionRestriction('サーバーの部品', ['start', 'components']),
        APP_SOURCE_RESTRICTION,
      ]),
      '@typescript-eslint/no-restricted-imports': restrictValueImports(
        PURE_VALUE_RESTRICTIONS,
      ),
    },
  },
  {
    name: 'frontend/direction/pure-tests',
    files: PURE_POSITION_TEST_FILES,
    rules: {
      '@typescript-eslint/no-restricted-imports': restrictValueImports([]),
    },
  },
  {
    name: 'frontend/direction/start',
    files: ['start/**'],
    rules: {
      'no-restricted-imports': restrictImports([
        reverseDirectionRestriction('TanStack Startとの接続', ['components']),
        APP_SOURCE_RESTRICTION,
      ]),
    },
  },
  {
    name: 'frontend/direction/components',
    files: ['components/**'],
    rules: {
      'no-restricted-imports': restrictImports([
        SERVER_ONLY_FILE_RESTRICTION,
        APP_SOURCE_RESTRICTION,
      ]),
      '@typescript-eslint/no-restricted-imports': restrictValueImports([
        SERVER_VALUE_RESTRICTION,
        BROWSER_SENTRY_RESTRICTION,
      ]),
    },
  },
  {
    name: 'frontend/browser-bundle/start-and-app',
    files: ['start/**', 'src/**'],
    ignores: [
      '**/*.server.ts',
      'src/server.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': restrictValueImports([
        BROWSER_SENTRY_RESTRICTION,
      ]),
    },
  },
  {
    name: 'frontend/direction/app-composition',
    files: ['src/composition/**'],
    rules: {
      'no-restricted-imports': restrictImports([
        COMPOSITION_TO_ROUTES_RESTRICTION,
      ]),
    },
  },
];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

// 旧形式の設定はpluginsを名前の配列で持つため、オブジェクトで持つものだけを平坦な形式の設定として受け付ける
const isFlatConfig = (value: unknown): value is Linter.Config =>
  isRecord(value) && !Array.isArray(value.plugins);

const flatConfigsOf = (
  pluginName: string,
  plugin: PluginWithConfigs,
  path: readonly string[],
): Linter.Config[] => {
  const found = path.reduce<unknown>(
    (current, key) => (isRecord(current) ? current[key] : undefined),
    plugin.configs,
  );
  const configs: readonly unknown[] = Array.isArray(found) ? found : [found];
  if (configs.length === 0 || !configs.every(isFlatConfig)) {
    throw new Error(
      `${pluginName}のconfigs.${path.join('.')}が平坦な形式の設定ではありません。`,
    );
  }
  return [...configs];
};

const OFF_SEVERITIES: ReadonlySet<unknown> = new Set([0, 'off']);

const isEnabledRule = (entry: Linter.RuleEntry | undefined): boolean =>
  entry !== undefined &&
  !OFF_SEVERITIES.has(Array.isArray(entry) ? entry[0] : entry);

const REACT_HOOKS_PREFIX = 'react-hooks/';

const ESLINT_REACT_PREFIX = '@eslint-react/';

// 2つのプラグインが同名で持つフックとReact Compilerの前提の規則は、@eslint-reactが推奨で有効にするものだけを@eslint-reactへ寄せる。@eslint-reactが実験的として推奨から外す規則(refs・immutability・globalsなど)はreact-hooksの規則を残し、どちらでも検査されない規則を作らない
const reactHooksConflictsOf = (
  eslintReactRecommended: readonly Linter.Config[],
  conflictConfigs: readonly Linter.Config[],
): Linter.Config => {
  const eslintReactRules: Partial<Linter.RulesRecord> = Object.fromEntries(
    eslintReactRecommended.flatMap(({ rules }) => Object.entries(rules ?? {})),
  );
  const conflictRuleIds = conflictConfigs.flatMap(({ rules }) =>
    Object.keys(rules ?? {}),
  );
  return {
    name: 'frontend/react-hooks-conflicts',
    rules: Object.fromEntries(
      conflictRuleIds
        .filter(
          (ruleId) =>
            ruleId.startsWith(REACT_HOOKS_PREFIX) &&
            isEnabledRule(
              eslintReactRules[
                ruleId.replace(REACT_HOOKS_PREFIX, ESLINT_REACT_PREFIX)
              ],
            ),
        )
        .map((ruleId): [string, Linter.RuleEntry] => [ruleId, 'off']),
    ),
  };
};

// 型情報付きの検査の対象外である設定ファイルには、型情報を使うReactの規則も当てない
const CONFIG_FILES = ['**/*.config.ts'];

// TanStack Routerは存在しないページとリダイレクトをErrorではない合図のオブジェクトを投げて伝えるため、その2つだけをError以外の例外として許す
const ROUTER_THROWABLES = [
  {
    from: 'package',
    package: '@tanstack/router-core',
    name: ['NotFoundError', 'Redirect'],
  },
] as const;

export function createFrontendLintConfig({
  eslintReact,
  reactHooks,
  jsxA11y,
  tanstackQuery,
  tanstackRouter,
  storybook,
}: FrontendLintDependencies): Linter.Config[] {
  const eslintReactRecommended = flatConfigsOf(
    '@eslint-react/eslint-plugin',
    eslintReact,
    ['recommended-type-checked'],
  );
  return [
    ...eslintReactRecommended,
    ...flatConfigsOf('eslint-plugin-react-hooks', reactHooks, [
      'flat',
      'recommended-latest',
    ]),
    reactHooksConflictsOf(
      eslintReactRecommended,
      flatConfigsOf('@eslint-react/eslint-plugin', eslintReact, [
        'disable-conflict-eslint-plugin-react-hooks',
      ]),
    ),
    ...flatConfigsOf('eslint-plugin-jsx-a11y-x', jsxA11y, ['recommended']),
    ...flatConfigsOf('@tanstack/eslint-plugin-query', tanstackQuery, [
      'flat/recommended',
    ]),
    ...flatConfigsOf('@tanstack/eslint-plugin-router', tanstackRouter, [
      'flat/recommended',
    ]),
    ...flatConfigsOf('eslint-plugin-storybook', storybook, [
      'flat/recommended',
    ]),
    ...flatConfigsOf('@eslint-react/eslint-plugin', eslintReact, [
      'disable-type-checked',
    ]).map((config) => ({ ...config, files: CONFIG_FILES })),
    {
      name: 'frontend/no-raw-html',
      rules: {
        '@eslint-react/dom-no-dangerously-set-innerhtml': 'error',
        'no-restricted-syntax': ['error', ...RAW_HTML_SYNTAX_RESTRICTIONS],
      },
    },
    {
      name: 'frontend/router-throwables',
      files: ['**/*.ts', '**/*.tsx'],
      ignores: CONFIG_FILES,
      rules: {
        '@typescript-eslint/only-throw-error': [
          'error',
          { allow: [...ROUTER_THROWABLES] },
        ],
      },
    },
    ZOD_ENTRY_RULE,
    ...DEPENDENCY_DIRECTION_RULES,
    ZOD_ENTRY_FILE_RULE,
  ];
}
