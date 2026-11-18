import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、ソースを構文解析して値を比べる
const REPO_ROOT = join(import.meta.dir, '..');

const COMMON_SPONSORSHIP_TIERS =
  'apps/common-lib/sponsorship/sponsorship-tiers.ts';
const COMMON_SPONSORSHIP_PERIOD =
  'apps/common-lib/sponsorship/sponsorship-period.ts';
const DB_SPONSORSHIPS = 'apps/db/schema/sponsorship/sponsorships.ts';

const parseSource = (path: string): ts.SourceFile =>
  ts.createSourceFile(
    path,
    readFileSync(join(REPO_ROOT, path), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

const descendantsOf = (node: ts.Node): readonly ts.Node[] =>
  node.getChildren().flatMap((child) => [child, ...descendantsOf(child)]);

const onlyOne = <T>(matches: readonly T[], description: string): T => {
  const [match] = matches;
  if (matches.length !== 1 || match === undefined) {
    throw new Error(
      `${description}を1つだけ見つけられません(${String(matches.length)}件)`,
    );
  }
  return match;
};

// `as const`・`satisfies`・括弧と、配列を凍結するObject.freeze(<配列>)の包みを外す
const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  if (
    ts.isCallExpression(expression) &&
    expression.expression.getText() === 'Object.freeze' &&
    expression.arguments[0] !== undefined
  ) {
    return unwrapExpression(expression.arguments[0]);
  }
  return expression;
};

const readInitializer = (path: string, name: string): ts.Expression => {
  const declaration = onlyOne(
    descendantsOf(parseSource(path)).filter(
      (node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name,
    ),
    `${path}の${name}の宣言`,
  );
  if (declaration.initializer === undefined) {
    throw new Error(`${path}の${name}に初期化子がありません`);
  }
  return unwrapExpression(declaration.initializer);
};

const readNumber = (path: string, name: string): number => {
  const initializer = readInitializer(path, name);
  if (!ts.isNumericLiteral(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子が数値リテラルではありません: ${initializer.getText()}`,
    );
  }
  return Number(initializer.getText().replaceAll('_', ''));
};

const readStringArray = (path: string, name: string): readonly string[] => {
  const initializer = readInitializer(path, name);
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子が配列リテラルではありません: ${initializer.getText()}`,
    );
  }
  return initializer.elements.map((element) => {
    if (!ts.isStringLiteral(element)) {
      throw new Error(
        `${path}の${name}の要素が文字列リテラルではありません: ${element.getText()}`,
      );
    }
    return element.text;
  });
};

describe('申込のティアと日数の上限の写し(apps/db/schema/sponsorship/sponsorships.ts)', () => {
  test('CHECK制約に使うティアの一覧がcommon-libのSPONSORSHIP_TIERSと順も含めて一致する', () => {
    expect(readStringArray(DB_SPONSORSHIPS, 'SPONSORSHIP_TIERS')).toEqual(
      readStringArray(COMMON_SPONSORSHIP_TIERS, 'SPONSORSHIP_TIERS'),
    );
  });

  test('CHECK制約に使う掲載期間の日数の上限がcommon-libのSPONSORSHIP_MAX_DAYSと一致する', () => {
    expect(readNumber(DB_SPONSORSHIPS, 'SPONSORSHIP_MAX_DAYS')).toBe(
      readNumber(COMMON_SPONSORSHIP_PERIOD, 'SPONSORSHIP_MAX_DAYS'),
    );
  });
});
