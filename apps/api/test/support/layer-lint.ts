import { expect } from 'bun:test';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

export type AppName = 'api' | 'event';

export interface ImportCase {
  readonly statement: string;
  readonly reported: boolean;
}

export interface PositionCase {
  readonly file: string;
  readonly imports: readonly ImportCase[];
}

const APPS_DIR = join(import.meta.dirname, '..', '..', '..');

export const LINT_TIMEOUT_MS = 60_000;

const RULE_IDS: ReadonlySet<string | null> = new Set([
  'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports',
]);

const linters = new Map<AppName, ESLint>(
  (['api', 'event'] as const).map((app) => [
    app,
    new ESLint({
      cwd: join(APPS_DIR, app),
      overrideConfigFile: join(APPS_DIR, app, 'eslint.config.ts'),
      // 型情報付きの解析はディスク上に無いファイルを扱えず、importの規則は型情報を使わないため、型情報無しで違反例を検査する
      overrideConfig: tseslint.configs.disableTypeChecked,
    }),
  ]),
);

export const forbidden = (statement: string): ImportCase => ({
  statement,
  reported: true,
});

export const allowed = (statement: string): ImportCase => ({
  statement,
  reported: false,
});

export const reportedStatementsOf = async (
  app: AppName,
  { file, imports }: PositionCase,
): Promise<readonly string[]> => {
  const statements = imports.map(({ statement }) => statement);
  const linter = linters.get(app);
  if (linter === undefined) {
    throw new Error(`${app}の静的解析を用意していません。`);
  }
  const [result] = await linter.lintText(`${statements.join('\n')}\n`, {
    filePath: join(APPS_DIR, app, file),
  });
  if (result === undefined) {
    throw new Error(`${file}の静的解析の結果がありません。`);
  }
  expect(result.fatalErrorCount).toBe(0);
  // 1つのimportが複数のパターンに当たると同じ行が複数回報告されるため、報告された行の集合で比べる
  return [
    ...new Set(
      result.messages
        .filter(({ ruleId }) => RULE_IDS.has(ruleId))
        .map(({ line }) => statements[line - 1] ?? ''),
    ),
  ];
};

export const expectedStatementsOf = ({
  imports,
}: PositionCase): readonly string[] =>
  imports.filter(({ reported }) => reported).map(({ statement }) => statement);

export const identityImportsFromAuth = (
  toSrc: string,
): readonly ImportCase[] => [
  forbidden(`import { a } from '${toSrc}domain/identity/handle';`),
  forbidden(`import type { b } from '${toSrc}application/identity/ports';`),
  forbidden(
    `import { c } from '${toSrc}infrastructure/identity/d1-user-account-store';`,
  ),
  forbidden(
    `import { d } from '${toSrc}presentation/graphql/modules/identity/index';`,
  ),
  allowed(
    `import { checkPasswordLength } from '${toSrc}../common-lib/identity/account-input-rules';`,
  ),
  allowed(`import type { e } from '${toSrc}../lib/core/identity/ports';`),
];
