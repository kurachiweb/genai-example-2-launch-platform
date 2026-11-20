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
const BACKEND_PRODUCT_PORTS = 'apps/backend-lib/core/product/ports.ts';
const BACKEND_ENGAGEMENT_PORTS = 'apps/backend-lib/core/engagement/ports.ts';
const DB_MODERATION_ACTIONS = 'apps/db/schema/moderation/moderation-actions.ts';
const BACKEND_MATCH_MODEL = 'apps/backend-lib/core/match/match-model.ts';
const ADMIN_MATCH_RESULT_LABELS =
  'apps/admin/src/components/moderation/products/match-result-labels.ts';
const ADMIN_MODERATION_MESSAGES =
  'apps/admin/src/components/moderation/shared/moderation-messages.ts';

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

const readStringConstant = (path: string, name: string): string => {
  const initializer = readInitializer(path, name);
  if (!ts.isStringLiteral(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子が文字列リテラルではありません: ${initializer.getText()}`,
    );
  }
  return initializer.text;
};

// new Set([<文字列>...])の要素を読む
const readStringSet = (path: string, name: string): readonly string[] => {
  const initializer = readInitializer(path, name);
  const [argument] = ts.isNewExpression(initializer)
    ? (initializer.arguments ?? [])
    : [];
  if (
    !ts.isNewExpression(initializer) ||
    initializer.expression.getText() !== 'Set' ||
    argument === undefined ||
    !ts.isArrayLiteralExpression(argument)
  ) {
    throw new Error(
      `${path}の${name}の初期化子が配列リテラルを渡すnew Setではありません: ${initializer.getText()}`,
    );
  }
  return argument.elements.map((element) => {
    if (!ts.isStringLiteral(element)) {
      throw new Error(
        `${path}の${name}の要素が文字列リテラルではありません: ${element.getText()}`,
      );
    }
    return element.text;
  });
};

// キーが識別子か文字列リテラルの代入だけのオブジェクトのキーを宣言の順に読む
const readPropertyNames = (path: string, name: string): readonly string[] => {
  const initializer = readInitializer(path, name);
  if (!ts.isObjectLiteralExpression(initializer)) {
    throw new Error(
      `${path}の${name}の初期化子がオブジェクトリテラルではありません: ${initializer.getText()}`,
    );
  }
  return initializer.properties.map((property) => {
    if (
      !ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ) {
      throw new Error(
        `${path}の${name}の要素が識別子か文字列のキーの代入ではありません: ${property.getText()}`,
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

describe('ローンチ状態の写し(apps/common-lib/moderation/moderation-labels.ts)', () => {
  test('ADMIN_LAUNCH_STATESがproduct-launchの型AdminProductLaunchStateの5値と順も含めて一致する', () => {
    expect(
      readStringArray(COMMON_MODERATION_LABELS, 'ADMIN_LAUNCH_STATES'),
    ).toEqual(
      readStringUnion(BACKEND_PRODUCT_PORTS, 'AdminProductLaunchState'),
    );
  });
});

describe('コメントの状態の写し(apps/common-lib/moderation/moderation-labels.ts)', () => {
  test('ADMIN_COMMENT_STATESがengagementの型AdminCommentStateの5値と順も含めて一致する', () => {
    expect(
      readStringArray(COMMON_MODERATION_LABELS, 'ADMIN_COMMENT_STATES'),
    ).toEqual(readStringUnion(BACKEND_ENGAGEMENT_PORTS, 'AdminCommentState'));
  });

  test('コメントの状態は非公開化・削除・匿名化・投稿者が不可視・表示中の5値である', () => {
    expect(
      readStringUnion(BACKEND_ENGAGEMENT_PORTS, 'AdminCommentState'),
    ).toEqual([
      'hidden',
      'deleted',
      'anonymized',
      'author_unavailable',
      'shown',
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

describe('マッチの値の写し(apps/admin/src/components/moderation)', () => {
  test('種別の表示名のキーがmatch-engineのMATCH_KINDSと順も含めて一致する', () => {
    expect(
      readPropertyNames(ADMIN_MODERATION_MESSAGES, 'MATCH_KIND_LABELS'),
    ).toEqual(readStringArray(BACKEND_MATCH_MODEL, 'MATCH_KINDS'));
  });

  test('予選の種別がmatch-engineのMATCH_KINDSに含まれる', () => {
    expect(readStringArray(BACKEND_MATCH_MODEL, 'MATCH_KINDS')).toContain(
      readStringConstant(ADMIN_MATCH_RESULT_LABELS, 'QUALIFIER_KIND'),
    );
  });

  test('勝敗の表示名のキーがmatch-engineのENTRY_RESULTSと順も含めて一致する', () => {
    expect(
      readPropertyNames(ADMIN_MATCH_RESULT_LABELS, 'RESULT_LABELS'),
    ).toEqual(readStringArray(BACKEND_MATCH_MODEL, 'ENTRY_RESULTS'));
  });

  test('不戦勝と敗北の結果がmatch-engineのENTRY_RESULTSに含まれる', () => {
    const upstream = readStringArray(BACKEND_MATCH_MODEL, 'ENTRY_RESULTS');
    expect(upstream).toContain(
      readStringConstant(ADMIN_MATCH_RESULT_LABELS, 'BYE_RESULT'),
    );
    expect(upstream).toContain(
      readStringConstant(ADMIN_MATCH_RESULT_LABELS, 'LOST_RESULT'),
    );
  });

  test('開始前の段階がmatch-engineのMATCH_PHASESに含まれる', () => {
    expect(readStringArray(BACKEND_MATCH_MODEL, 'MATCH_PHASES')).toContain(
      readStringConstant(ADMIN_MATCH_RESULT_LABELS, 'SCHEDULED_PHASE'),
    );
  });

  test('両者敗北の決着がmatch-engineのMATCH_DECISIONSに含まれる', () => {
    const upstream = readStringArray(BACKEND_MATCH_MODEL, 'MATCH_DECISIONS');
    const decisions = readStringSet(
      ADMIN_MATCH_RESULT_LABELS,
      'BOTH_LOST_DECISIONS',
    );
    expect(decisions).not.toHaveLength(0);
    for (const decision of decisions) {
      expect(upstream).toContain(decision);
    }
  });
});
