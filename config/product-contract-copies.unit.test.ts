import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、ソースを構文解析して値を比べる
const REPO_ROOT = join(import.meta.dir, '..');

const COMMON_PRODUCT_INPUT_RULES =
  'apps/common-lib/product/product-input-rules.ts';
const DB_PRODUCT_SCREENSHOTS = 'apps/db/schema/product/product-screenshots.ts';
const API_LAUNCH_DATE_RULES =
  'apps/api/src/domain/product/launch-date-rules.ts';
const CLIENT_LAUNCH_MESSAGES =
  'apps/client/src/components/product/launch-messages.ts';

const SCREENSHOT_POSITION_CHECK = 'product_screenshots_position_check';

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

const unwrapExpression = (expression: ts.Expression): ts.Expression =>
  ts.isAsExpression(expression) ||
  ts.isSatisfiesExpression(expression) ||
  ts.isParenthesizedExpression(expression)
    ? unwrapExpression(expression.expression)
    : expression;

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

const readString = (path: string, name: string): string => {
  const initializer = readInitializer(path, name);
  if (!ts.isStringLiteral(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子が文字列リテラルではありません: ${initializer.getText()}`,
    );
  }
  return initializer.text;
};

const isCheckNamed = (node: ts.Node, checkName: string): boolean => {
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== 'check'
  ) {
    return false;
  }
  const [nameArgument] = node.arguments;
  return (
    nameArgument !== undefined &&
    ts.isStringLiteral(nameArgument) &&
    nameArgument.text === checkName
  );
};

// drizzleのcheck(<名前>, sql`<条件>`)の条件のテンプレートの文字列
const readCheckCondition = (path: string, checkName: string): string => {
  const call = onlyOne(
    descendantsOf(parseSource(path))
      .filter((node) => isCheckNamed(node, checkName))
      .filter(ts.isCallExpression),
    `${path}のCHECK制約${checkName}`,
  );
  const condition = call.arguments[1];
  if (condition === undefined || !ts.isTaggedTemplateExpression(condition)) {
    throw new Error(
      `${path}のCHECK制約${checkName}の条件がsqlのタグ付きテンプレートではありません`,
    );
  }
  return condition.template.getText();
};

const BETWEEN_PATTERN = /between (\d+) and (\d+)`$/u;

const betweenRangeOf = (
  condition: string,
): { readonly min: number; readonly max: number } => {
  const match = BETWEEN_PATTERN.exec(condition);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`CHECK制約の条件がbetweenの形ではありません: ${condition}`);
  }
  return { min: Number(match[1]), max: Number(match[2]) };
};

const RELAUNCH_DAYS_PATTERN = /敗北後(\d+)日/u;

const relaunchDaysOf = (text: string): number => {
  const days = RELAUNCH_DAYS_PATTERN.exec(text)?.[1];
  if (days === undefined) {
    throw new Error(`敗北後の日数を文言から読み取れません: ${text}`);
  }
  return Number(days);
};

describe('スクリーンショットの位置のCHECKの写し(apps/db/schema/product/product-screenshots.ts)', () => {
  test('位置の範囲が0からcommon-libのPRODUCT_SCREENSHOTS_MAXの1つ前までと一致する', () => {
    const screenshotsMax = readNumber(
      COMMON_PRODUCT_INPUT_RULES,
      'PRODUCT_SCREENSHOTS_MAX',
    );

    const range = betweenRangeOf(
      readCheckCondition(DB_PRODUCT_SCREENSHOTS, SCREENSHOT_POSITION_CHECK),
    );

    expect(screenshotsMax).toBe(20);
    expect(range).toEqual({ min: 0, max: screenshotsMax - 1 });
  });
});

describe('Ultrasの導線の文言の写し(components/product/launch-messages.ts)', () => {
  test('ULTRAS_RELAUNCH_PROMOTIONの敗北後の日数がapiのENTITLED_RELAUNCH_INTERVAL_DAYSと一致する', () => {
    const entitledDays = readNumber(
      API_LAUNCH_DATE_RULES,
      'ENTITLED_RELAUNCH_INTERVAL_DAYS',
    );

    const promotedDays = relaunchDaysOf(
      readString(CLIENT_LAUNCH_MESSAGES, 'ULTRAS_RELAUNCH_PROMOTION'),
    );

    expect(entitledDays).toBe(2);
    expect(promotedDays).toBe(entitledDays);
  });
});
