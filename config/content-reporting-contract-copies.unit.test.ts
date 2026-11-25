import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、ソースを構文解析して値を比べる
const REPO_ROOT = join(import.meta.dir, '..');

const COMMON_REPORT_RULES = 'apps/common-lib/reporting/report-rules.ts';
const COMMON_REPORT_CASE_RULES =
  'apps/common-lib/reporting/report-case-rules.ts';
const COMMON_MODERATION_ACTIONS =
  'apps/common-lib/moderation/moderation-actions.ts';
const DB_REPORT_CASES = 'apps/db/schema/reporting/report-cases.ts';
const DB_MIGRATIONS_DIR = 'apps/db/migrations';
const SEED_MIGRATION_SUFFIX = '_content_reporting_seed';
const API_SUBMISSION_RESOLVERS =
  'apps/api/src/presentation/graphql/modules/reporting/submission-resolvers.ts';
const CLIENT_REPORT_BOT_ACTIONS =
  'apps/client/src/components/reporting/bot-actions.ts';

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

// `as const`・`satisfies`・括弧と、凍結するObject.freeze(<値>)の包みを外す
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

const stringOf = (path: string, name: string, node: ts.Node): string => {
  if (!ts.isStringLiteral(node)) {
    throw new Error(
      `${path}の${name}の値が文字列リテラルではありません: ${node.getText()}`,
    );
  }
  return node.text;
};

const readStringArray = (path: string, name: string): readonly string[] => {
  const initializer = readInitializer(path, name);
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子が配列リテラルではありません: ${initializer.getText()}`,
    );
  }
  return initializer.elements.map((element) => stringOf(path, name, element));
};

const readStringConstant = (path: string, name: string): string =>
  stringOf(path, name, readInitializer(path, name));

// 値が文字列リテラルの代入だけのオブジェクトの値を宣言の順に読む
const readPropertyValues = (path: string, name: string): readonly string[] => {
  const initializer = readInitializer(path, name);
  if (!ts.isObjectLiteralExpression(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子がオブジェクトリテラルではありません: ${initializer.getText()}`,
    );
  }
  return initializer.properties.map((property) => {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(
        `${path}の${name}の要素が代入ではありません: ${property.getText()}`,
      );
    }
    return stringOf(path, name, property.initializer);
  });
};

// 型の別名の文字列リテラルの合併(`'a' | 'b'`)の値を宣言の順に読む
const readStringUnion = (path: string, name: string): readonly string[] => {
  const declaration = onlyOne(
    descendantsOf(parseSource(path)).filter(
      (node): node is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(node) && node.name.text === name,
    ),
    `${path}の型${name}の宣言`,
  );
  const members = ts.isUnionTypeNode(declaration.type)
    ? declaration.type.types
    : [declaration.type];
  return members.map((member) => {
    if (!ts.isLiteralTypeNode(member) || !ts.isStringLiteral(member.literal)) {
      throw new Error(
        `${path}の型${name}の要素が文字列リテラルの型ではありません: ${member.getText()}`,
      );
    }
    return member.literal.text;
  });
};

const seedMigrationSql = (): string => {
  const name = onlyOne(
    readdirSync(join(REPO_ROOT, DB_MIGRATIONS_DIR)).filter((candidate) =>
      candidate.endsWith(SEED_MIGRATION_SUFFIX),
    ),
    `${SEED_MIGRATION_SUFFIX}で終わるマイグレーション`,
  );
  return readFileSync(
    join(REPO_ROOT, DB_MIGRATIONS_DIR, name, 'migration.sql'),
    'utf8',
  );
};

describe('案件のCHECK制約の値の写し(apps/db/schema/reporting/report-cases.ts)', () => {
  test('対象の種類の一覧がcommon-libのREPORT_TARGET_KINDSと順も含めて一致する', () => {
    expect(readStringArray(DB_REPORT_CASES, 'REPORT_TARGET_KINDS')).toEqual(
      readStringArray(COMMON_REPORT_RULES, 'REPORT_TARGET_KINDS'),
    );
  });

  test('対応ステータスの一覧がcommon-libのREPORT_CASE_STATUSESと順も含めて一致する', () => {
    expect(readStringArray(DB_REPORT_CASES, 'REPORT_CASE_STATUSES')).toEqual(
      readStringArray(COMMON_REPORT_CASE_RULES, 'REPORT_CASE_STATUSES'),
    );
  });

  test('完了の状態の一覧が、common-libの対応ステータスから未完了の状態の型OpenReportCaseStatusを除いたものと一致する', () => {
    const open = readStringUnion(
      COMMON_REPORT_CASE_RULES,
      'OpenReportCaseStatus',
    );

    expect(readStringArray(DB_REPORT_CASES, 'CLOSED_STATUSES')).toEqual(
      readStringArray(COMMON_REPORT_CASE_RULES, 'REPORT_CASE_STATUSES').filter(
        (status) => !open.includes(status),
      ),
    );
  });

  test('措置の一覧がcommon-libのREPORT_RESOLUTIONSと順も含めて一致する', () => {
    expect(readStringArray(DB_REPORT_CASES, 'REPORT_RESOLUTIONS')).toEqual(
      readStringArray(COMMON_REPORT_CASE_RULES, 'REPORT_RESOLUTIONS'),
    );
  });

  test('措置の記録を持てる措置の一覧が、common-libの対象の種類ごとの措置MEASURESの値の集合と一致する', () => {
    expect(
      readStringArray(DB_REPORT_CASES, 'REPORT_MEASURES').toSorted(),
    ).toEqual(
      readPropertyValues(COMMON_REPORT_CASE_RULES, 'MEASURES').toSorted(),
    );
  });

  test('通知の状態の一覧がugc-moderationのMODERATION_NOTICE_STATUSESと順も含めて一致する', () => {
    expect(readStringArray(DB_REPORT_CASES, 'REPORT_NOTICE_STATUSES')).toEqual(
      readStringArray(COMMON_MODERATION_ACTIONS, 'MODERATION_NOTICE_STATUSES'),
    );
  });
});

describe('標準カテゴリの写し(apps/db/migrations/*_content_reporting_seed)', () => {
  test.each([
    ['REPORT_CATEGORY_INFRINGEMENT_ID', 'REPORT_CATEGORY_INFRINGEMENT_NAME'],
    ['REPORT_CATEGORY_OTHER_ID', 'REPORT_CATEGORY_OTHER_NAME'],
  ])(
    '初期データの行のIDと名前がcommon-libの%s・%sと一致する',
    (idName, nameName) => {
      const id = readStringConstant(COMMON_REPORT_RULES, idName);
      const name = readStringConstant(COMMON_REPORT_RULES, nameName);

      expect(seedMigrationSql()).toContain(`('${id}', '${name}', 1,`);
    },
  );
});

describe('bot判定の操作名の写し(apps/client/src/components/reporting/bot-actions.ts)', () => {
  test('REPORT_BOT_ACTIONがapiの通報のリゾルバのREPORT_BOT_ACTIONと一致する', () => {
    expect(
      readStringConstant(CLIENT_REPORT_BOT_ACTIONS, 'REPORT_BOT_ACTION'),
    ).toBe(readStringConstant(API_SUBMISSION_RESOLVERS, 'REPORT_BOT_ACTION'));
  });
});
