import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、ソースを構文解析して値を比べる
const REPO_ROOT = join(import.meta.dir, '..');

const COMMON_API_KEY_RULES = 'apps/common-lib/public-api/api-key-rules.ts';
const DB_API_KEYS = 'apps/db/schema/public-api/api-keys.ts';
const API_PUBLIC_API_APP = 'apps/api/src/presentation/rest/public-api-app.ts';
const E2E_PUBLIC_API = 'e2e/support/public-api.ts';

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

describe('権限スコープの値の写し(apps/db/schema/public-api/api-keys.ts)', () => {
  test('読み取りだけの機能のCHECK制約に使う値の一覧がcommon-libのREAD_LEVELSと順も含めて一致する', () => {
    const shared = readStringArray(COMMON_API_KEY_RULES, 'READ_LEVELS');

    expect(shared).toEqual(['none', 'read']);
    expect(readStringArray(DB_API_KEYS, 'READ_LEVELS')).toEqual(shared);
  });

  test('書き込める機能のCHECK制約に使う値の一覧がcommon-libのWRITE_LEVELSと順も含めて一致する', () => {
    const shared = readStringArray(COMMON_API_KEY_RULES, 'WRITE_LEVELS');

    expect(shared).toEqual(['none', 'read', 'read_write']);
    expect(readStringArray(DB_API_KEYS, 'WRITE_LEVELS')).toEqual(shared);
  });
});

describe('公開REST APIの基準パスの写し(e2e/support/public-api.ts)', () => {
  test('E2Eの補助が要求を送る基準パスがapiのPUBLIC_API_BASE_PATHと一致する', () => {
    const shared = readString(API_PUBLIC_API_APP, 'PUBLIC_API_BASE_PATH');

    expect(shared).toBe('/v1');
    expect(readString(E2E_PUBLIC_API, 'PUBLIC_API_BASE_PATH')).toBe(shared);
  });
});

const API_KEY_TOKEN = 'apps/api/src/domain/public-api/api-key-token.ts';
const LOG_REDACTION = 'apps/backend-lib/core/logging/redaction.ts';
const CLIENT_OPENAPI_DOCUMENT =
  'apps/client/src/components/public-api/openapi-document.ts';

const asRegex = (expression: ts.Expression, description: string): RegExp => {
  if (expression.kind !== ts.SyntaxKind.RegularExpressionLiteral) {
    throw new Error(
      `${description}が正規表現リテラルではありません: ${expression.getText()}`,
    );
  }
  const text = expression.getText();
  const lastSlash = text.lastIndexOf('/');
  return new RegExp(text.slice(1, lastSlash), text.slice(lastSlash + 1));
};

const readRegex = (path: string, name: string): RegExp =>
  asRegex(readInitializer(path, name), `${path}の${name}`);

const readRegexProperty = (
  path: string,
  name: string,
  property: string,
): RegExp => {
  const initializer = readInitializer(path, name);
  if (!ts.isObjectLiteralExpression(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子がオブジェクトリテラルではありません`,
    );
  }
  const assignment = onlyOne(
    initializer.properties.filter(
      (node): node is ts.PropertyAssignment =>
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === property,
    ),
    `${path}の${name}の${property}`,
  );
  return asRegex(assignment.initializer, `${path}の${name}の${property}`);
};

describe('APIキーの平文の形式の写し(apps/backend-lib/core/logging/redaction.ts)', () => {
  test('ログとエラーレポートの伏せ字の形がapiのAPI_KEY_TOKEN_PATTERNの両端の錨を外した形と一致し、全ての出現を伏せる', () => {
    const token = readRegex(API_KEY_TOKEN, 'API_KEY_TOKEN_PATTERN');
    const redaction = readRegexProperty(
      LOG_REDACTION,
      'API_KEY_PATTERN',
      'pattern',
    );

    expect(token.source.startsWith('^') && token.source.endsWith('$')).toBe(
      true,
    );
    expect(redaction.source).toBe(token.source.slice(1, -1));
    expect(redaction.flags).toBe('g');
  });
});

describe('公開REST APIの仕様書の位置の写し(apps/client/src/components/public-api/openapi-document.ts)', () => {
  test('APIドキュメントの画面が仕様書を取る基準パスと仕様書のパスがapiの値と一致する', () => {
    expect(readString(CLIENT_OPENAPI_DOCUMENT, 'PUBLIC_API_BASE_PATH')).toBe(
      readString(API_PUBLIC_API_APP, 'PUBLIC_API_BASE_PATH'),
    );
    expect(readString(CLIENT_OPENAPI_DOCUMENT, 'OPENAPI_DOCUMENT_PATH')).toBe(
      readString(API_PUBLIC_API_APP, 'OPENAPI_DOCUMENT_PATH'),
    );
  });
});
