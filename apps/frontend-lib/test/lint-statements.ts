import { join } from 'node:path';

import eslintReact from '@eslint-react/eslint-plugin';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

export interface StatementCase {
  readonly statement: string;
  readonly reported: boolean;
}

export interface PositionCase {
  readonly file: string;
  readonly statements: readonly StatementCase[];
}

export const APP_DIR = join(import.meta.dirname, '..');

export const LINT_TIMEOUT_MS = 60_000;

export const ERROR_SEVERITY = 2;

export const IMPORT_RULE_IDS: ReadonlySet<string | null> = new Set([
  'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports',
]);

export const linter = new ESLint({
  cwd: APP_DIR,
  overrideConfigFile: join(APP_DIR, 'eslint.config.ts'),
  // 型情報付きの解析はディスク上に無いファイルを扱えず、検査する規則は型情報を使わないため、型情報無しで違反例を検査する
  overrideConfig: [
    tseslint.configs.disableTypeChecked,
    eslintReact.configs['disable-type-checked'],
  ],
});

export const forbidden = (statement: string): StatementCase => ({
  statement,
  reported: true,
});

export const allowed = (statement: string): StatementCase => ({
  statement,
  reported: false,
});

export const reportedStatementsOf = async (
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
  if (result.fatalErrorCount > 0) {
    throw new Error(
      `${file}の静的解析が構文を解析できませんでした: ${result.messages.map(({ message }) => message).join(' / ')}`,
    );
  }
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

export const expectedStatementsOf = ({
  statements,
}: PositionCase): readonly string[] =>
  statements
    .filter(({ reported }) => reported)
    .map(({ statement }) => statement);
