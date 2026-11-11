import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、ソースを構文解析して値を比べる
const REPO_ROOT = join(import.meta.dir, '..');

const COMMON_HELP_ARTICLE_STATUS =
  'apps/common-lib/help/help-article-status.ts';
const COMMON_HELP_CATEGORY_CONSTANTS =
  'apps/common-lib/help/help-category-constants.ts';
const DB_HELP_ARTICLES = 'apps/db/schema/help/help-articles.ts';
const DB_MIGRATIONS_DIR = 'apps/db/migrations';

const SEED_MIGRATION_SUFFIX = '_help_center_seed';

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

const readString = (path: string, name: string): string => {
  const initializer = readInitializer(path, name);
  if (!ts.isStringLiteral(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子が文字列リテラルではありません: ${initializer.getText()}`,
    );
  }
  return initializer.text;
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

describe('記事のステータスの写し(apps/db/schema/help/help-articles.ts)', () => {
  test('CHECK制約に使う値の一覧がcommon-libのHELP_ARTICLE_STATUSESと順も含めて一致する', () => {
    expect(readStringArray(DB_HELP_ARTICLES, 'HELP_ARTICLE_STATUSES')).toEqual(
      readStringArray(COMMON_HELP_ARTICLE_STATUS, 'HELP_ARTICLE_STATUSES'),
    );
  });
});

describe('標準カテゴリの写し(apps/db/migrations/*_help_center_seed)', () => {
  test('初期データの行のIDと名前がcommon-libのHELP_CATEGORY_OTHER_ID・HELP_CATEGORY_OTHER_NAMEと一致する', () => {
    const id = readString(
      COMMON_HELP_CATEGORY_CONSTANTS,
      'HELP_CATEGORY_OTHER_ID',
    );
    const name = readString(
      COMMON_HELP_CATEGORY_CONSTANTS,
      'HELP_CATEGORY_OTHER_NAME',
    );

    expect(seedMigrationSql()).toContain(`('${id}', '${name}', 1, 1,`);
  });
});
