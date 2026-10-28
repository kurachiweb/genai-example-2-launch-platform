import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import eslintReact from '@eslint-react/eslint-plugin';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

interface StatementCase {
  readonly statement: string;
  readonly reported: boolean;
}

interface PositionCase {
  readonly file: string;
  readonly statements: readonly StatementCase[];
}

const APP_DIR = join(import.meta.dirname, '..');

const LINT_TIMEOUT_MS = 60_000;

const ERROR_SEVERITY = 2;

const IMPORT_RULE_IDS: ReadonlySet<string | null> = new Set([
  'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports',
]);

const RAW_HTML_RULE_IDS: ReadonlySet<string | null> = new Set([
  '@eslint-react/dom-no-dangerously-set-innerhtml',
  'no-restricted-syntax',
]);

const linter = new ESLint({
  cwd: APP_DIR,
  overrideConfigFile: join(APP_DIR, 'eslint.config.ts'),
  // 型情報付きの解析はディスク上に無いファイルを扱えず、検査する規則は型情報を使わないため、型情報無しで違反例を検査する
  overrideConfig: [
    tseslint.configs.disableTypeChecked,
    eslintReact.configs['disable-type-checked'],
  ],
});

const forbidden = (statement: string): StatementCase => ({
  statement,
  reported: true,
});

const allowed = (statement: string): StatementCase => ({
  statement,
  reported: false,
});

const reportedStatementsOf = async (
  { file, statements }: PositionCase,
  ruleIds: ReadonlySet<string | null>,
): Promise<readonly string[]> => {
  const lines = statements.map(({ statement }) => statement);
  const [result] = await linter.lintText(`${lines.join('\n')}\n`, {
    filePath: join(APP_DIR, file),
  });
  if (result === undefined) {
    throw new Error(`${file}の静的解析の結果がありません。`);
  }
  expect(result.fatalErrorCount).toBe(0);
  // 1つの文が複数のパターンに当たると同じ行が複数回報告されるため、報告された行の集合で比べる
  return [
    ...new Set(
      result.messages
        .filter(
          ({ ruleId, severity }) =>
            ruleIds.has(ruleId) && severity === ERROR_SEVERITY,
        )
        .map(({ line }) => lines[line - 1] ?? ''),
    ),
  ];
};

const expectedStatementsOf = ({
  statements,
}: PositionCase): readonly string[] =>
  statements
    .filter(({ reported }) => reported)
    .map(({ statement }) => statement);

const OFF_SEVERITIES: ReadonlySet<unknown> = new Set([0, 'off']);

const enabledRulesOf = async (file: string): Promise<ReadonlySet<string>> => {
  const config = (await linter.calculateConfigForFile(join(APP_DIR, file))) as {
    readonly rules: Readonly<Record<string, unknown>>;
  };
  return new Set(
    Object.entries(config.rules)
      .filter(([, entry]) => {
        const severity: unknown = Array.isArray(entry) ? entry[0] : entry;
        return !OFF_SEVERITIES.has(severity);
      })
      .map(([ruleId]) => ruleId),
  );
};

const RAW_HTML_STATEMENTS: readonly StatementCase[] = [
  forbidden(
    "export const Raw = () => <div dangerouslySetInnerHTML={{ __html: '<p></p>' }} />;",
  ),
  forbidden("document.body.innerHTML = '<p></p>';"),
  forbidden("document.body.outerHTML = '<p></p>';"),
  forbidden("document.body.innerHTML += '<p></p>';"),
  forbidden("document.body['innerHTML'] = '<p></p>';"),
  forbidden("document.body['outerHTML'] = '<p></p>';"),
  forbidden("document.body.insertAdjacentHTML('beforeend', '<p></p>');"),
  forbidden("document.body['insertAdjacentHTML']('beforeend', '<p></p>');"),
  forbidden(
    "export const RawElement = React.createElement('div', { dangerouslySetInnerHTML: { __html: '<p></p>' } });",
  ),
  forbidden(
    "export const RawNamedElement = createElement('div', { 'dangerouslySetInnerHTML': { __html: '<p></p>' } });",
  ),
  allowed("export const Safe = () => <div>{'<p></p>'}</div>;"),
  allowed('export const text = document.body.innerHTML;'),
  allowed("document.body.textContent = '<p></p>';"),
  allowed("document.body.insertAdjacentText('beforeend', '<p></p>');"),
  allowed(
    "document.body.insertAdjacentElement('beforeend', document.createElement('p'));",
  ),
  allowed(
    "export const SafeElement = React.createElement('div', { className: 'x' }, '<p></p>');",
  ),
  allowed(
    "export const ChildElement = createElement('div', null, { dangerouslySetInnerHTML: '' });",
  ),
];

interface CompilerRuleCase {
  readonly name: string;
  readonly ruleName: string;
  readonly source: readonly string[];
}

// React Compilerの前提の規則は2つのプラグインに同名で存在するため、どちらの規則で報告されても違反を検出したとみなす
const COMPILER_RULE_CASES: readonly CompilerRuleCase[] = [
  {
    name: '描画中のrefの読み書き',
    ruleName: 'refs',
    source: [
      "import { useRef } from 'react';",
      'export function Counter() {',
      '  const count = useRef(0);',
      '  count.current = count.current + 1;',
      '  return <p>{count.current}</p>;',
      '}',
    ],
  },
  {
    name: '描画中のモジュール変数の書き換え',
    ruleName: 'globals',
    source: [
      'let renderCount = 0;',
      'export function Tracker() {',
      '  renderCount = renderCount + 1;',
      '  return <p>{renderCount}</p>;',
      '}',
    ],
  },
  {
    name: '描画中のpropsの書き換え',
    ruleName: 'immutability',
    source: [
      'export function Item({ item }: { item: { count: number } }) {',
      '  item.count = item.count + 1;',
      '  return <p>{item.count}</p>;',
      '}',
    ],
  },
];

const compilerRuleIdsOf = (ruleName: string): ReadonlySet<string> =>
  new Set([`react-hooks/${ruleName}`, `@eslint-react/${ruleName}`]);

const reportedCompilerRulesOf = async ({
  ruleName,
  source,
}: CompilerRuleCase): Promise<readonly string[]> => {
  const [result] = await linter.lintText(`${source.join('\n')}\n`, {
    filePath: join(APP_DIR, 'components/sample/compiler-rule.tsx'),
  });
  if (result === undefined) {
    throw new Error('React Compilerの前提の規則の静的解析の結果がありません。');
  }
  expect(result.fatalErrorCount).toBe(0);
  const ruleIds = compilerRuleIdsOf(ruleName);
  return result.messages
    .filter(
      ({ ruleId, severity }) =>
        ruleId !== null && ruleIds.has(ruleId) && severity === ERROR_SEVERITY,
    )
    .map(({ ruleId }) => ruleId ?? '');
};

const RAW_HTML_CASES: readonly PositionCase[] = [
  'components/sample/violation.tsx',
  'utilities/sample/violation.tsx',
  'start/sample/violation.tsx',
  'src/routes/violation.tsx',
  'src/components/violation.tsx',
].map((file) => ({ file, statements: RAW_HTML_STATEMENTS }));

const RUNTIME_PACKAGE_STATEMENTS: readonly StatementCase[] = [
  forbidden("import { useState } from 'react';"),
  forbidden("import { jsx } from 'react/jsx-runtime';"),
  forbidden("import { createRoot } from 'react-dom/client';"),
  forbidden("import { useQuery } from '@tanstack/react-query';"),
  forbidden("import { createRouter } from '@tanstack/react-router';"),
  forbidden("import { createServerFn } from '@tanstack/react-start';"),
  forbidden("import { a } from '@tanstack/react-start/server';"),
  forbidden("import { env } from 'cloudflare:workers';"),
  forbidden("import * as SentryCloudflare from '@sentry/cloudflare';"),
  forbidden("import { init } from '@sentry/tanstackstart-react';"),
  allowed("import type { ReactNode } from 'react';"),
  allowed("import type { QueryKey } from '@tanstack/react-query';"),
  allowed("import type { ExecutionContext } from 'cloudflare:workers';"),
  allowed("import type { Event } from '@sentry/cloudflare';"),
  allowed("import type { ErrorEvent } from '@sentry/core';"),
  allowed("import { b } from './react';"),
];

const PURE_POSITION_CASES: readonly PositionCase[] = [
  {
    file: 'utilities/sample/violation.ts',
    statements: [
      ...RUNTIME_PACKAGE_STATEMENTS,
      forbidden("import { c } from '../../server/http/csrf';"),
      forbidden("import type { d } from '../../server/entry/app-profile';"),
      forbidden("import { e } from '../../start/query-client';"),
      forbidden("import { f } from '../../components/ui/button/button';"),
      forbidden("import { g } from '../../../src/composition/relay-routes';"),
      allowed("import { h } from '../datetime/relative-time';"),
      allowed("import { i } from './sibling';"),
    ],
  },
  {
    file: 'server/http/violation.ts',
    statements: [
      ...RUNTIME_PACKAGE_STATEMENTS,
      forbidden("import { c } from '../../start/query-client';"),
      forbidden("import { d } from '../../components/ui/button/button';"),
      forbidden("import { e } from '../../../src/composition/relay-routes';"),
      allowed("import { f } from '../../utilities/class-names';"),
      allowed("import { g } from '../relay/relay-route';"),
      allowed("import { h } from './csrf';"),
    ],
  },
];

const RENDERING_POSITION_CASES: readonly PositionCase[] = [
  {
    file: 'start/graphql/violation.ts',
    statements: [
      forbidden("import { a } from '../../components/ui/button/button';"),
      forbidden("import { b } from '../../../src/composition/relay-routes';"),
      allowed("import { useQuery } from '@tanstack/react-query';"),
      allowed("import { createServerFn } from '@tanstack/react-start';"),
      allowed("import { env } from 'cloudflare:workers';"),
      forbidden("import * as Sentry from '@sentry/tanstackstart-react';"),
      forbidden(
        "import { sentryGlobalRequestMiddleware } from '@sentry/tanstackstart-react';",
      ),
      allowed(
        "import type * as SentryTypes from '@sentry/tanstackstart-react';",
      ),
      allowed("import { c } from '../../server/relay/relay-route';"),
      allowed("import { d } from '../../utilities/class-names';"),
      allowed("import { e } from './execute-graphql.server';"),
    ],
  },
  {
    file: 'start/observability/violation.server.ts',
    statements: [
      allowed(
        "import { sentryGlobalRequestMiddleware } from '@sentry/tanstackstart-react';",
      ),
      allowed("import { a } from './report-error.server';"),
    ],
  },
  {
    file: 'start/sample/violation.unit.test.ts',
    statements: [
      allowed(
        "import { sentryGlobalRequestMiddleware } from '@sentry/tanstackstart-react';",
      ),
    ],
  },
  {
    file: 'components/form/violation.tsx',
    statements: [
      forbidden("import { a } from '../../start/request-context.server';"),
      forbidden(
        "import { b } from '../../start/graphql/execute-graphql.server.ts';",
      ),
      forbidden("import type { c } from '../../start/request-context.server';"),
      forbidden(
        "import { createFrontendServerEntry } from '../../server/entry/create-frontend-server-entry';",
      ),
      forbidden("import { d } from '../../../src/composition/relay-routes';"),
      forbidden("import { init } from '@sentry/tanstackstart-react';"),
      allowed("import type { init } from '@sentry/tanstackstart-react';"),
      allowed(
        "import type { FrontendRequestContext } from '../../server/entry/request-context';",
      ),
      allowed(
        "import { readRequestNonce } from '../../start/request-context';",
      ),
      allowed("import { e } from '../../utilities/class-names';"),
      allowed("import { useState } from 'react';"),
      allowed("import { useQuery } from '@tanstack/react-query';"),
      allowed("import { f } from './form-field';"),
    ],
  },
  {
    file: 'src/routes/violation.tsx',
    statements: [
      forbidden("import { ErrorBoundary } from '@sentry/tanstackstart-react';"),
      allowed("import type { init } from '@sentry/tanstackstart-react';"),
    ],
  },
  {
    file: 'src/server.ts',
    statements: [
      allowed(
        "import { wrapFetchWithSentry } from '@sentry/tanstackstart-react';",
      ),
    ],
  },
  {
    file: 'src/composition/violation.ts',
    statements: [
      forbidden("import { Route } from '../routes/index';"),
      forbidden("import { a } from '../routes/system/status';"),
      allowed("import { b } from '../components/site-header';"),
      allowed("import { c } from '../../lib/server/relay/relay-route';"),
    ],
  },
];

const ZOD_VALUE_STATEMENTS: readonly StatementCase[] = [
  forbidden("import { z } from 'zod';"),
  forbidden("import * as zod from 'zod';"),
  forbidden("import z from 'zod';"),
  forbidden("import { z as zv4 } from 'zod/v4';"),
  forbidden("import { config } from 'zod/v4/core';"),
  forbidden("import { z } from 'zod/mini';"),
  forbidden("export { z } from 'zod';"),
  allowed("import type { z } from 'zod';"),
  allowed("import type { $ZodType } from 'zod/v4/core';"),
  allowed("import { zodResolver } from '@hookform/resolvers/zod';"),
];

const ZOD_POSITION_CASES: readonly PositionCase[] = [
  {
    file: 'utilities/sample/violation.ts',
    statements: [
      ...ZOD_VALUE_STATEMENTS,
      allowed("import { z } from '../validation/zod';"),
    ],
  },
  {
    file: 'server/http/violation.ts',
    statements: [
      ...ZOD_VALUE_STATEMENTS,
      allowed("import { z } from '../../utilities/validation/zod';"),
    ],
  },
  {
    file: 'start/graphql/violation.ts',
    statements: ZOD_VALUE_STATEMENTS,
  },
  {
    file: 'components/form/violation.tsx',
    statements: ZOD_VALUE_STATEMENTS,
  },
  {
    file: 'components/form/violation.stories.tsx',
    statements: ZOD_VALUE_STATEMENTS,
  },
  {
    file: 'components/form/violation.browser.test.tsx',
    statements: ZOD_VALUE_STATEMENTS,
  },
  {
    file: 'src/routes/violation.tsx',
    statements: [
      ...ZOD_VALUE_STATEMENTS,
      allowed("import { z } from '../../lib/utilities/validation/zod';"),
    ],
  },
  {
    file: 'src/composition/violation.ts',
    statements: ZOD_VALUE_STATEMENTS,
  },
  {
    file: 'test/config/violation.unit.test.ts',
    statements: ZOD_VALUE_STATEMENTS,
  },
  {
    file: 'utilities/validation/zod.ts',
    statements: [
      allowed("import { z } from 'zod';"),
      forbidden("import { useState } from 'react';"),
      forbidden("import { c } from '../../server/http/csrf';"),
    ],
  },
];

describe('画面向けの静的解析の規則', () => {
  describe('ZodのJITを止める設定を経ないZodの値の読み込みを禁止する', () => {
    test.each(ZOD_POSITION_CASES.map((position) => [position.file, position]))(
      '%sで設定済みの部品以外からのZodの値の読み込みをエラーとして報告する',
      async (_file, position) => {
        expect(await reportedStatementsOf(position, IMPORT_RULE_IDS)).toEqual(
          expectedStatementsOf(position),
        );
      },
      LINT_TIMEOUT_MS,
    );
  });

  describe('生のHTMLの挿入を禁止する', () => {
    test.each(RAW_HTML_CASES.map((position) => [position.file, position]))(
      '%sで危険なHTMLの属性とinnerHTML・outerHTMLへの代入をエラーとして報告する',
      async (_file, position) => {
        expect(await reportedStatementsOf(position, RAW_HTML_RULE_IDS)).toEqual(
          expectedStatementsOf(position),
        );
      },
      LINT_TIMEOUT_MS,
    );
  });

  describe('依存の方向に反するimportを禁止する', () => {
    test.each(
      [...PURE_POSITION_CASES, ...RENDERING_POSITION_CASES].map((position) => [
        position.file,
        position,
      ]),
    )(
      '%sで逆向きのimportをエラーとして報告する',
      async (_file, position) => {
        expect(await reportedStatementsOf(position, IMPORT_RULE_IDS)).toEqual(
          expectedStatementsOf(position),
        );
      },
      LINT_TIMEOUT_MS,
    );
  });

  describe('画面の実装に固有の規則を適用する', () => {
    test.each(COMPILER_RULE_CASES.map((ruleCase) => [ruleCase.name, ruleCase]))(
      '%sをReact Compilerの前提の規則でエラーとして報告する',
      async (_name, ruleCase) => {
        expect(
          (await reportedCompilerRulesOf(ruleCase)).length,
        ).toBeGreaterThan(0);
      },
      LINT_TIMEOUT_MS,
    );

    test(
      'React Compilerの前提の規則を同名で重複して報告しない',
      async () => {
        const rules = await enabledRulesOf('components/sample/sample.tsx');
        const duplicated = [...rules].filter(
          (ruleId) =>
            ruleId.startsWith('react-hooks/') &&
            rules.has(ruleId.replace('react-hooks/', '@eslint-react/')),
        );

        expect(duplicated).toEqual([]);
      },
      LINT_TIMEOUT_MS,
    );

    test(
      '画面部品にReact・フック・アクセシビリティ・TanStack Query・TanStack Routerの規則を適用する',
      async () => {
        const rules = await enabledRulesOf('components/sample/sample.tsx');

        expect(
          [
            '@eslint-react/no-missing-key',
            'react-hooks/preserve-manual-memoization',
            'jsx-a11y-x/alt-text',
            '@tanstack/query/exhaustive-deps',
            '@tanstack/router/create-route-property-order',
          ].filter((ruleId) => !rules.has(ruleId)),
        ).toEqual([]);
      },
      LINT_TIMEOUT_MS,
    );

    test(
      'Error以外を投げる式の検査で、TanStack Routerの存在しないページとリダイレクトの合図だけを許す',
      async () => {
        const typeAwareLinter = new ESLint({
          cwd: APP_DIR,
          overrideConfigFile: join(APP_DIR, 'eslint.config.ts'),
        });
        const config = (await typeAwareLinter.calculateConfigForFile(
          join(APP_DIR, 'start/sample.ts'),
        )) as { readonly rules: Readonly<Record<string, unknown>> };

        expect(config.rules['@typescript-eslint/only-throw-error']).toEqual([
          ERROR_SEVERITY,
          expect.objectContaining({
            allow: [
              {
                from: 'package',
                package: '@tanstack/router-core',
                name: ['NotFoundError', 'Redirect'],
              },
            ],
          }),
        ]);
      },
      LINT_TIMEOUT_MS,
    );
    test(
      'ストーリーにカタログの書き方の規則を適用する',
      async () => {
        const rules = await enabledRulesOf(
          'components/sample/sample.stories.tsx',
        );

        expect(
          ['storybook/default-exports', 'storybook/story-exports'].filter(
            (ruleId) => !rules.has(ruleId),
          ),
        ).toEqual([]);
      },
      LINT_TIMEOUT_MS,
    );
  });
});
