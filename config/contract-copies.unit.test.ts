import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// 他のアプリのファイルをimportすると、ルートの型検査とカバレッジの分母にそのファイルが入るため、ソースを構文解析で読むか子プロセスで実行して比べる
const REPO_ROOT = join(import.meta.dir, '..');

const RELAY_CONTRACT = 'apps/frontend-lib/server/relay/relay-contract.ts';
const GATEWAY_HEADERS_SOURCE =
  'apps/api/src/presentation/gateway/gateway-headers.ts';
const SESSION_ACCESS_SOURCE =
  'apps/api/src/presentation/gateway/session-access.ts';
const SESSION_VERIFIER_SOURCE =
  'apps/api/src/application/session/session-verifier.ts';
const GRAPHQL_RESULT = 'apps/frontend-lib/utilities/graphql/graphql-result.ts';
const ERROR_CODES_SOURCE = 'apps/api/src/presentation/graphql/error-codes.ts';
const FRONTEND_SECURITY_HEADERS =
  'apps/frontend-lib/server/http/security-headers.ts';
const FRONTEND_SECURITY_POLICY =
  'apps/frontend-lib/server/http/security-policy.ts';
const BACKEND_SECURITY_HEADERS =
  'apps/backend-lib/workers/http/security-headers.ts';
const FRONTEND_LOGGING = 'apps/frontend-lib/server/observability/logging.ts';
const FRONTEND_REDACTION_PATTERNS =
  'apps/frontend-lib/utilities/observability/redaction-patterns.ts';
const BACKEND_REDACTION = 'apps/backend-lib/core/logging/redaction.ts';
const FRONTEND_RATE_LIMIT_KEY_HASH =
  'apps/frontend-lib/server/http/rate-limit-key-hash.ts';
const BACKEND_RATE_LIMIT_KEY =
  'apps/backend-lib/core/rate-limit/rate-limit-key.ts';
const BACKEND_KEYED_HASHER = 'apps/backend-lib/core/crypto/keyed-hasher.ts';

type ExtractedValue =
  | string
  | number
  | RegExp
  | readonly string[]
  | { readonly [key: string]: ExtractedValue };

interface DeclarationRef {
  readonly path: string;
  readonly name: string;
}

const describeRef = ({ path, name }: DeclarationRef): string =>
  `${path}の${name}`;

const parsedSources = new Map<string, ts.SourceFile>();

const parseSource = (path: string): ts.SourceFile => {
  const cached = parsedSources.get(path);
  if (cached !== undefined) {
    return cached;
  }
  const source = ts.createSourceFile(
    path,
    readFileSync(join(REPO_ROOT, path), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  parsedSources.set(path, source);
  return source;
};

const collectDeclarations = (
  node: ts.Node,
  name: string,
): readonly ts.VariableDeclaration[] => [
  ...(ts.isVariableDeclaration(node) &&
  ts.isIdentifier(node.name) &&
  node.name.text === name
    ? [node]
    : []),
  ...node.getChildren().flatMap((child) => collectDeclarations(child, name)),
];

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
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === 'Object' &&
    expression.expression.name.text === 'freeze' &&
    expression.arguments.length === 1 &&
    expression.arguments[0] !== undefined
  ) {
    return unwrapExpression(expression.arguments[0]);
  }
  return expression;
};

const findInitializer = (ref: DeclarationRef): ts.Expression => {
  const declarations = collectDeclarations(parseSource(ref.path), ref.name);
  const [declaration] = declarations;
  if (declarations.length !== 1 || declaration?.initializer === undefined) {
    throw new Error(
      `${describeRef(ref)}の初期化子付きの宣言を1つだけ見つけられません(${String(declarations.length)}件)`,
    );
  }
  return unwrapExpression(declaration.initializer);
};

const failToExtract = (ref: DeclarationRef, node: ts.Node): never => {
  throw new Error(
    `${describeRef(ref)}の初期化子から値を取り出せない形です: ${ts.SyntaxKind[node.kind]} ${node.getText()}`,
  );
};

const regExpOf = (literal: ts.RegularExpressionLiteral): RegExp => {
  const flagsStart = literal.text.lastIndexOf('/');
  return new RegExp(
    literal.text.slice(1, flagsStart),
    literal.text.slice(flagsStart + 1),
  );
};

const stringLiteralsOf = (
  ref: DeclarationRef,
  array: ts.ArrayLiteralExpression,
): readonly string[] =>
  array.elements.map((element) =>
    ts.isStringLiteral(element) ? element.text : failToExtract(ref, element),
  );

const joinedElementsOf = (
  ref: DeclarationRef,
  expression: ts.Expression,
): readonly string[] | undefined => {
  if (
    !ts.isCallExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== 'join'
  ) {
    return undefined;
  }
  const receiver = unwrapExpression(expression.expression.expression);
  return ts.isArrayLiteralExpression(receiver)
    ? stringLiteralsOf(ref, receiver)
    : failToExtract(ref, receiver);
};

const propertyNameOf = (
  ref: DeclarationRef,
  property: ts.ObjectLiteralElementLike,
): string =>
  property.name !== undefined &&
  (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : failToExtract(ref, property);

const propertyInitializersOf = (
  ref: DeclarationRef,
  object: ts.ObjectLiteralExpression,
): readonly (readonly [string, ts.Expression])[] =>
  object.properties.map((property) =>
    ts.isPropertyAssignment(property)
      ? [propertyNameOf(ref, property), unwrapExpression(property.initializer)]
      : failToExtract(ref, property),
  );

const extractValue = (
  ref: DeclarationRef,
  expression: ts.Expression,
): ExtractedValue => {
  if (ts.isStringLiteral(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) {
    return Number(expression.getText().replaceAll('_', ''));
  }
  if (ts.isRegularExpressionLiteral(expression)) {
    return regExpOf(expression);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return stringLiteralsOf(ref, expression);
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return Object.fromEntries(
      propertyInitializersOf(ref, expression).map(([key, initializer]) => [
        key,
        extractValue(ref, initializer),
      ]),
    );
  }
  const joined = joinedElementsOf(ref, expression);
  if (joined !== undefined && ts.isCallExpression(expression)) {
    const [separator] = expression.arguments;
    return separator !== undefined &&
      expression.arguments.length === 1 &&
      ts.isStringLiteral(separator)
      ? joined.join(separator.text)
      : failToExtract(ref, expression);
  }
  return failToExtract(ref, expression);
};

const failOnType = (ref: DeclarationRef, expected: string): never => {
  throw new Error(`${describeRef(ref)}の値が${expected}ではありません`);
};

const readValue = (path: string, name: string): ExtractedValue => {
  const ref = { path, name };
  return extractValue(ref, findInitializer(ref));
};

const readString = (path: string, name: string): string => {
  const value = readValue(path, name);
  return typeof value === 'string'
    ? value
    : failOnType({ path, name }, '文字列');
};

const readNumber = (path: string, name: string): number => {
  const value = readValue(path, name);
  return typeof value === 'number' ? value : failOnType({ path, name }, '数値');
};

const readRegExp = (path: string, name: string): RegExp => {
  const value = readValue(path, name);
  return value instanceof RegExp
    ? value
    : failOnType({ path, name }, '正規表現');
};

const isStringArray = (value: ExtractedValue): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const readStringArray = (path: string, name: string): readonly string[] => {
  const value = readValue(path, name);
  return isStringArray(value)
    ? value
    : failOnType({ path, name }, '文字列の配列');
};

const readStringRecord = (
  path: string,
  name: string,
): Readonly<Record<string, string>> => {
  const value = readValue(path, name);
  if (
    typeof value !== 'object' ||
    value instanceof RegExp ||
    isStringArray(value) ||
    !Object.values(value).every((item) => typeof item === 'string')
  ) {
    return failOnType({ path, name }, '文字列の値のオブジェクト');
  }
  return value as Readonly<Record<string, string>>;
};

const readJoinedProperty = (
  path: string,
  name: string,
  property: string,
): readonly string[] => {
  const ref = { path, name };
  const object = findInitializer(ref);
  if (!ts.isObjectLiteralExpression(object)) {
    return failToExtract(ref, object);
  }
  const initializer = propertyInitializersOf(ref, object).find(
    ([key]) => key === property,
  )?.[1];
  if (initializer === undefined) {
    throw new Error(`${describeRef(ref)}に${property}の項目がありません`);
  }
  return joinedElementsOf(ref, initializer) ?? failToExtract(ref, initializer);
};

const withoutUnicodeFlag = (flags: string): string => flags.replace('u', '');

const isRegExpConstructionWithFlags = (
  node: ts.Node,
): node is ts.NewExpression & {
  readonly arguments: ts.NodeArray<ts.Expression>;
} =>
  ts.isNewExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'RegExp' &&
  node.arguments?.length === 2 &&
  node.arguments[1] !== undefined &&
  ts.isStringLiteral(node.arguments[1]);

// frontend-libだけが正規表現にuフラグを付けるため、その違いだけを除いた形にする
const removeUnicodeFlags: ts.TransformerFactory<ts.Expression> =
  (context) => (root) => {
    const visit = (node: ts.Node): ts.Node => {
      const visited = ts.visitEachChild(node, visit, context);
      if (ts.isRegularExpressionLiteral(visited)) {
        const flagsStart = visited.text.lastIndexOf('/') + 1;
        return ts.factory.createRegularExpressionLiteral(
          visited.text.slice(0, flagsStart) +
            withoutUnicodeFlag(visited.text.slice(flagsStart)),
        );
      }
      if (isRegExpConstructionWithFlags(visited)) {
        const [pattern, flags] = visited.arguments;
        if (
          pattern !== undefined &&
          flags !== undefined &&
          ts.isStringLiteral(flags)
        ) {
          return ts.factory.updateNewExpression(
            visited,
            visited.expression,
            visited.typeArguments,
            [
              pattern,
              ts.factory.createStringLiteral(withoutUnicodeFlag(flags.text)),
            ],
          );
        }
      }
      return visited;
    };
    const transformed = visit(root);
    return ts.isExpression(transformed) ? transformed : root;
  };

const printer = ts.createPrinter({ removeComments: true });

const printInitializerWithoutUnicodeFlags = (
  path: string,
  name: string,
): string => {
  const result = ts.transform(findInitializer({ path, name }), [
    removeUnicodeFlags,
  ]);
  try {
    const [transformed] = result.transformed;
    if (transformed === undefined) {
      throw new Error(`${path}の${name}の初期化子を変換できません`);
    }
    return printer.printNode(
      ts.EmitHint.Expression,
      transformed,
      parseSource(path),
    );
  } finally {
    result.dispose();
  }
};

const sortedUnique = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].toSorted();

describe('中継の契約の写し(relay-contract.ts)', () => {
  test('中継が付けるヘッダーと呼び出し元のヘッダーを合わせると、apiのGATEWAY_HEADERSの項目と名前が一致する', () => {
    const relayRequestHeaders = readStringRecord(
      RELAY_CONTRACT,
      'RELAY_REQUEST_HEADERS',
    );
    const callerHeaders = readStringRecord(
      RELAY_CONTRACT,
      'GATEWAY_CALLER_HEADERS',
    );

    expect(
      Object.keys(relayRequestHeaders).filter((key) =>
        Object.hasOwn(callerHeaders, key),
      ),
    ).toEqual([]);
    expect({ ...relayRequestHeaders, ...callerHeaders }).toEqual(
      readStringRecord(GATEWAY_HEADERS_SOURCE, 'GATEWAY_HEADERS'),
    );
  });

  test('セッションの指示のヘッダーがapiのSESSION_RESPONSE_HEADERSと一致する', () => {
    expect(
      readStringRecord(RELAY_CONTRACT, 'SESSION_INSTRUCTION_HEADERS'),
    ).toEqual(
      readStringRecord(GATEWAY_HEADERS_SOURCE, 'SESSION_RESPONSE_HEADERS'),
    );
  });

  test('セッションの破棄の指示の値がapiの公開されていないCLEAR_HEADER_VALUEと一致する', () => {
    expect(readString(RELAY_CONTRACT, 'SESSION_CLEAR_VALUE')).toBe(
      readString(SESSION_ACCESS_SOURCE, 'CLEAR_HEADER_VALUE'),
    );
  });

  test('セッションの識別子の形式と有効期間の上限がapiのsession-verifier.tsの同名の値と一致する', () => {
    expect(String(readRegExp(RELAY_CONTRACT, 'SESSION_TOKEN_PATTERN'))).toBe(
      String(readRegExp(SESSION_VERIFIER_SOURCE, 'SESSION_TOKEN_PATTERN')),
    );
    expect(readNumber(RELAY_CONTRACT, 'MAX_SESSION_MAX_AGE_SECONDS')).toBe(
      readNumber(SESSION_VERIFIER_SOURCE, 'MAX_SESSION_MAX_AGE_SECONDS'),
    );
  });
});

describe('エラーコードの写し(graphql-result.ts)', () => {
  test('想定外の失敗のコードのうちapiの写しの部分が、apiのGATEWAY_ERROR_CODESと要素の集合で一致する', () => {
    expect(
      sortedUnique(readStringArray(GRAPHQL_RESULT, 'GATEWAY_ERROR_CODES')),
    ).toEqual(
      sortedUnique(readStringArray(ERROR_CODES_SOURCE, 'GATEWAY_ERROR_CODES')),
    );
  });
});

describe('セキュリティヘッダーの写し(security-headers.ts・security-policy.ts)', () => {
  test('共通のヘッダーがbackend-libのSECURITY_HEADERSのPermissions-Policy以外の項目と一致する', () => {
    const { 'Permissions-Policy': permissionsPolicy, ...baseHeaders } =
      readStringRecord(BACKEND_SECURITY_HEADERS, 'SECURITY_HEADERS');

    expect(permissionsPolicy).toBeString();
    expect(
      readStringRecord(FRONTEND_SECURITY_HEADERS, 'BASE_SECURITY_HEADERS'),
    ).toEqual(baseHeaders);
  });

  test('Permissions-Policyの機能の並びがbackend-libの配列の各要素から=()を除いた並びと一致する', () => {
    const backendFeatures = readJoinedProperty(
      BACKEND_SECURITY_HEADERS,
      'SECURITY_HEADERS',
      'Permissions-Policy',
    ).map((entry) => {
      if (!entry.endsWith('=()')) {
        throw new Error(
          `${BACKEND_SECURITY_HEADERS}のPermissions-Policyの要素が=()で終わりません: ${entry}`,
        );
      }
      return entry.slice(0, -'=()'.length);
    });

    expect(
      readStringArray(FRONTEND_SECURITY_POLICY, 'PERMISSION_FEATURES'),
    ).toEqual(backendFeatures);
  });

  test('ページ以外のCSPがbackend-libのDEFAULT_CONTENT_SECURITY_POLICYと一致する', () => {
    expect(
      readString(FRONTEND_SECURITY_POLICY, 'NON_PAGE_CONTENT_SECURITY_POLICY'),
    ).toBe(
      readString(BACKEND_SECURITY_HEADERS, 'DEFAULT_CONTENT_SECURITY_POLICY'),
    );
  });
});

describe('伏せ字の写し(logging.ts・redaction-patterns.ts)', () => {
  test('属性名による伏せ字の並びがbackend-libのREDACTED_FIELD_PATTERNSと一致する', () => {
    expect(
      printInitializerWithoutUnicodeFlags(
        FRONTEND_LOGGING,
        'REDACTED_FIELD_PATTERNS',
      ),
    ).toBe(
      printInitializerWithoutUnicodeFlags(
        BACKEND_REDACTION,
        'REDACTED_FIELD_PATTERNS',
      ),
    );
  });

  test.each([
    'REDACTED',
    'REDACTION_PATTERNS',
    'API_KEY_PATTERN',
    'BEARER_TOKEN_PATTERN',
    'IPV4_OCTET',
    'IPV4_PATTERN',
    'H',
    'IPV6_PATTERN',
    'LIBRARY_CREDIT_CARD_NUMBER_REPLACEMENT',
    'libraryCreditCardReplacement',
    'CREDIT_CARD_PATTERN',
  ])(
    '値の形式による伏せ字の%sが、uフラグを除いてbackend-libの同名の宣言と一致する',
    (name) => {
      expect(
        printInitializerWithoutUnicodeFlags(FRONTEND_REDACTION_PATTERNS, name),
      ).toBe(printInitializerWithoutUnicodeFlags(BACKEND_REDACTION, name));
    },
  );
});

const HASH_COMPARISON_INPUT_VARIABLE = 'CONTRACT_COPIES_HASH_INPUT';

// 子プロセスのbunで評価するため、ルートの型検査の対象に入らない文字列にしている
const HASH_COMPARISON_SCRIPT = `
const { modules, pepper, cases } = JSON.parse(process.env.${HASH_COMPARISON_INPUT_VARIABLE});
const [frontend, backend, hasher] = await Promise.all([
  import(modules.frontend),
  import(modules.backend),
  import(modules.hasher),
]);
const backendHasher = hasher.createKeyedHasher(pepper);
const results = [];
for (const parts of cases) {
  results.push({
    parts,
    frontend: await frontend.hashRateLimitKey(pepper, ...parts),
    backend: await backend.hashRateLimitKey(backendHasher, ...parts),
  });
}
console.log(JSON.stringify(results));
`;

interface HashComparison {
  readonly parts: readonly string[];
  readonly frontend: string;
  readonly backend: string;
}

const HASH_COMPARISON_CASES: readonly (readonly string[])[] = [
  ['ip:203.0.113.5'],
  ['ip:2001:db8::1'],
  ['ip:unknown'],
  ['ip:198.51.100.7', 'route:/_bff/graphql'],
  ['利用者:テスト', '経路:送信'],
];

const runHashComparison = (): readonly HashComparison[] => {
  const result = Bun.spawnSync(
    [process.execPath, '--eval', HASH_COMPARISON_SCRIPT],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        [HASH_COMPARISON_INPUT_VARIABLE]: JSON.stringify({
          modules: {
            frontend: join(REPO_ROOT, FRONTEND_RATE_LIMIT_KEY_HASH),
            backend: join(REPO_ROOT, BACKEND_RATE_LIMIT_KEY),
            hasher: join(REPO_ROOT, BACKEND_KEYED_HASHER),
          },
          pepper: 'contract-copies-pepper-0123456789abcdef',
          cases: HASH_COMPARISON_CASES,
        }),
      },
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `レート制限のキーのハッシュ化の比較が終了コード${String(result.exitCode)}で失敗しました: ${result.stderr.toString()}`,
    );
  }
  return JSON.parse(result.stdout.toString()) as readonly HashComparison[];
};

describe('レート制限のキーのハッシュ化の写し(rate-limit-key-hash.ts)', () => {
  test('同じペッパーと部品から、backend-libのhashRateLimitKey(createKeyedHasher(pepper), ...parts)と同じ値を作る', () => {
    const comparisons = runHashComparison();

    expect(comparisons.map(({ parts }) => parts)).toEqual([
      ...HASH_COMPARISON_CASES,
    ]);
    for (const { frontend, backend } of comparisons) {
      expect(backend).toMatch(/^[A-Za-z0-9_-]{86}$/);
      expect(frontend).toBe(backend);
    }
  });
});
