import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、ソースを構文解析して値を比べる
const REPO_ROOT = join(import.meta.dir, '..');

const COMMON_MODERATION_ACTIONS =
  'apps/common-lib/moderation/moderation-actions.ts';
const COMMON_MODERATION_LABELS =
  'apps/common-lib/moderation/moderation-labels.ts';
const BACKEND_MEDIA_FILE = 'apps/backend-lib/core/media/media-file.ts';
const BACKEND_DISPOSABLE_EMAIL =
  'apps/backend-lib/core/identity/disposable-email.ts';
const BACKEND_USER_LIFECYCLE =
  'apps/backend-lib/core/identity/user-lifecycle.ts';
const BACKEND_PRODUCT_LIFECYCLE =
  'apps/backend-lib/core/product/product-lifecycle.ts';
const DB_MODERATION_ACTIONS = 'apps/db/schema/moderation/moderation-actions.ts';

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

const readObjectKeys = (path: string, name: string): readonly string[] => {
  const initializer = readInitializer(path, name);
  if (!ts.isObjectLiteralExpression(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子がオブジェクトリテラルではありません: ${initializer.getText()}`,
    );
  }
  return initializer.properties.map((property) => {
    if (
      !ts.isPropertyAssignment(property) ||
      !ts.isStringLiteral(property.name)
    ) {
      throw new Error(
        `${path}の${name}の要素が文字列のキーの代入ではありません: ${property.getText()}`,
      );
    }
    return property.name.text;
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

describe('隔離理由の写し(apps/common-lib/moderation/moderation-labels.ts)', () => {
  test('QUARANTINE_REASONSがmedia-pipelineのQUARANTINE_REASONSと順も含めて一致する', () => {
    expect(
      readStringArray(COMMON_MODERATION_LABELS, 'QUARANTINE_REASONS'),
    ).toEqual(readStringArray(BACKEND_MEDIA_FILE, 'QUARANTINE_REASONS'));
  });

  test('型QuarantineReasonがmedia-pipelineの型QuarantineReasonと一致する', () => {
    expect(
      readStringUnion(COMMON_MODERATION_LABELS, 'QuarantineReason'),
    ).toEqual(readStringUnion(BACKEND_MEDIA_FILE, 'QuarantineReason'));
  });
});

describe('使い捨て判定の写し(apps/common-lib/moderation/moderation-labels.ts)', () => {
  test('DISPOSABLE_EMAIL_JUDGEMENTSはidentity-authの型DisposableEmailStatusの値に、確認前を表すunverifiedを加えた一覧である', () => {
    expect(
      readStringArray(COMMON_MODERATION_LABELS, 'DISPOSABLE_EMAIL_JUDGEMENTS'),
    ).toEqual([
      ...readStringUnion(BACKEND_DISPOSABLE_EMAIL, 'DisposableEmailStatus'),
      'unverified',
    ]);
  });
});

describe('ライフサイクルのイベントの種類の写し(apps/common-lib/moderation/moderation-actions.ts)', () => {
  test('利用者の措置のイベントの種類がidentity-authのUSER_LIFECYCLE_EVENT_TYPESに含まれる', () => {
    const upstream = readStringArray(
      BACKEND_USER_LIFECYCLE,
      'USER_LIFECYCLE_EVENT_TYPES',
    );
    for (const type of readStringArray(
      COMMON_MODERATION_ACTIONS,
      'MODERATION_USER_LIFECYCLE_EVENTS',
    )) {
      expect(upstream).toContain(type);
    }
  });

  test('プロダクトの措置のイベントの種類がproduct-launchのPRODUCT_LIFECYCLE_EVENT_TYPESに含まれる', () => {
    const upstream = readStringArray(
      BACKEND_PRODUCT_LIFECYCLE,
      'PRODUCT_LIFECYCLE_EVENT_TYPES',
    );
    for (const type of readStringArray(
      COMMON_MODERATION_ACTIONS,
      'MODERATION_PRODUCT_LIFECYCLE_EVENTS',
    )) {
      expect(upstream).toContain(type);
    }
  });
});

describe('措置の記録のCHECK制約の値の写し(apps/db/schema/moderation/moderation-actions.ts)', () => {
  test('措置の種類の一覧がcommon-libのMODERATION_ACTIONSと順も含めて一致する', () => {
    expect(
      readStringArray(DB_MODERATION_ACTIONS, 'MODERATION_ACTIONS'),
    ).toEqual(readStringArray(COMMON_MODERATION_ACTIONS, 'MODERATION_ACTIONS'));
  });

  test('措置の種類の一覧がcommon-libのMODERATION_ACTION_DEFINITIONSの措置と順も含めて一致する', () => {
    expect(
      readStringArray(DB_MODERATION_ACTIONS, 'MODERATION_ACTIONS'),
    ).toEqual(
      readObjectKeys(
        COMMON_MODERATION_ACTIONS,
        'MODERATION_ACTION_DEFINITIONS',
      ),
    );
  });

  test('対象の種類の一覧がcommon-libのMODERATION_TARGET_KINDSと順も含めて一致する', () => {
    expect(
      readStringArray(DB_MODERATION_ACTIONS, 'MODERATION_TARGET_KINDS'),
    ).toEqual(
      readStringArray(COMMON_MODERATION_ACTIONS, 'MODERATION_TARGET_KINDS'),
    );
  });

  test('通知の状態の一覧がcommon-libのMODERATION_NOTICE_STATUSESと順も含めて一致する', () => {
    expect(
      readStringArray(DB_MODERATION_ACTIONS, 'MODERATION_NOTICE_STATUSES'),
    ).toEqual(
      readStringArray(COMMON_MODERATION_ACTIONS, 'MODERATION_NOTICE_STATUSES'),
    );
  });
});
