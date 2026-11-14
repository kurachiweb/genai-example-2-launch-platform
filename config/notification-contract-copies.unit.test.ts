import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、ソースを構文解析して値を比べる
const REPO_ROOT = join(import.meta.dir, '..');

const COMMON_NOTIFICATION_TOPICS =
  'apps/common-lib/notifications/notification-topics.ts';
const DB_NOTIFICATION_PREFERENCES =
  'apps/db/schema/notifications/notification-preferences.ts';
const BACKEND_NOTIFICATION_EVENT_CONTRACT =
  'apps/backend-lib/core/notifications/notification-event-contract.ts';
const DB_NOTIFICATION_EVENTS =
  'apps/db/schema/notifications/notification-events.ts';

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

describe('通知種別の写し(apps/db/schema/notifications/notification-preferences.ts)', () => {
  test('CHECK制約に使う値の一覧がcommon-libのNOTIFICATION_TOPICSと順も含めて一致する', () => {
    const shared = readStringArray(
      COMMON_NOTIFICATION_TOPICS,
      'NOTIFICATION_TOPICS',
    );

    expect(shared).toHaveLength(4);
    expect(
      readStringArray(DB_NOTIFICATION_PREFERENCES, 'NOTIFICATION_TOPICS'),
    ).toEqual(shared);
  });
});

describe('通知イベントの種類と賞の種類の写し(apps/db/schema/notifications/notification-events.ts)', () => {
  test.each([
    ['NOTIFICATION_EVENT_TYPES', 3],
    ['AWARD_KINDS', 2],
  ])(
    'CHECK制約に使う%sがbackend-libの同名の定数と順も含めて一致する',
    (name, length) => {
      const shared = readStringArray(BACKEND_NOTIFICATION_EVENT_CONTRACT, name);

      expect(shared).toHaveLength(length);
      expect(readStringArray(DB_NOTIFICATION_EVENTS, name)).toEqual(shared);
    },
  );
});
