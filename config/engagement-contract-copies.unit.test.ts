import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、ソースを構文解析して値を比べる
const REPO_ROOT = join(import.meta.dir, '..');

const COMMON_ENGAGEMENT_RULES =
  'apps/common-lib/engagement/engagement-rules.ts';
const DB_LAUNCH_COMMENTS = 'apps/db/schema/engagement/launch-comments.ts';
const DB_PRODUCT_RATINGS = 'apps/db/schema/engagement/product-ratings.ts';
const API_IDENTITY_ERRORS =
  'apps/api/src/application/identity/identity-errors.ts';
const CLIENT_COMMENT_MESSAGES =
  'apps/client/src/components/engagement/comment-messages.ts';
const CLIENT_RATING_MESSAGES =
  'apps/client/src/components/engagement/rating-messages.ts';

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

const numberOf = (expression: ts.Expression, description: string): number => {
  if (!ts.isNumericLiteral(expression)) {
    throw new Error(
      `${description}が数値リテラルではありません: ${expression.getText()}`,
    );
  }
  return Number(expression.getText().replaceAll('_', ''));
};

const readNumber = (path: string, name: string): number =>
  numberOf(readInitializer(path, name), `${path}の${name}の初期化子`);

const readNumberArray = (path: string, name: string): readonly number[] => {
  const initializer = readInitializer(path, name);
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子が配列リテラルではありません: ${initializer.getText()}`,
    );
  }
  return initializer.elements.map((element) =>
    numberOf(element, `${path}の${name}の要素`),
  );
};

const stringOf = (expression: ts.Expression, description: string): string => {
  if (!ts.isStringLiteral(expression)) {
    throw new Error(
      `${description}が文字列リテラルではありません: ${expression.getText()}`,
    );
  }
  return expression.text;
};

const readString = (path: string, name: string): string =>
  stringOf(readInitializer(path, name), `${path}の${name}の初期化子`);

const propertyInitializerOf = (
  object: ts.Expression,
  property: string,
  description: string,
): ts.Expression => {
  if (!ts.isObjectLiteralExpression(object)) {
    throw new Error(
      `${description}がオブジェクトリテラルではありません: ${object.getText()}`,
    );
  }
  const assignment = onlyOne(
    object.properties.filter(
      (element): element is ts.PropertyAssignment =>
        ts.isPropertyAssignment(element) &&
        (ts.isIdentifier(element.name) || ts.isStringLiteral(element.name)) &&
        element.name.text === property,
    ),
    `${description}の${property}の項目`,
  );
  return unwrapExpression(assignment.initializer);
};

// エラーの定義の一覧(コードごとの{ kind, message })から、指定したコードの文言を読む
const readErrorMessage = (path: string, name: string, code: string): string => {
  const description = `${path}の${name}`;
  const definition = propertyInitializerOf(
    readInitializer(path, name),
    code,
    description,
  );
  return stringOf(
    propertyInitializerOf(definition, 'message', `${description}の${code}`),
    `${description}の${code}の文言`,
  );
};

describe('コメントの階層の上限の写し(apps/db/schema/engagement/launch-comments.ts)', () => {
  test('CHECK制約に使う階層の上限がcommon-libのCOMMENT_MAX_DEPTHと一致する', () => {
    const shared = readNumber(COMMON_ENGAGEMENT_RULES, 'COMMENT_MAX_DEPTH');

    expect(shared).toBe(3);
    expect(readNumber(DB_LAUNCH_COMMENTS, 'COMMENT_MAX_DEPTH')).toBe(shared);
  });
});

describe('評価の値の写し(apps/db/schema/engagement/product-ratings.ts)', () => {
  test('CHECK制約に使う評価の値の一覧がcommon-libのRATING_SCORESと順も含めて一致する', () => {
    const shared = readNumberArray(COMMON_ENGAGEMENT_RULES, 'RATING_SCORES');

    expect(shared).toHaveLength(5);
    expect(readNumberArray(DB_PRODUCT_RATINGS, 'RATING_SCORES')).toEqual(
      shared,
    );
  });
});

describe('メールアドレス未確認の理由の文言の写し(apps/client/src/components/engagement)', () => {
  test('コメント欄と評価欄の無効の理由がAPIサーバーのemail_not_verifiedの文言と一致する', () => {
    const shared = readErrorMessage(
      API_IDENTITY_ERRORS,
      'IDENTITY_ERRORS',
      'email_not_verified',
    );

    expect(shared).toContain('メールアドレスの確認');
    expect(
      readString(CLIENT_COMMENT_MESSAGES, 'COMMENT_EMAIL_UNVERIFIED_REASON'),
    ).toBe(shared);
    expect(
      readString(CLIENT_RATING_MESSAGES, 'RATING_EMAIL_UNVERIFIED_REASON'),
    ).toBe(shared);
  });
});
