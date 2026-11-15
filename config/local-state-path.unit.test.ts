import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const REPO_ROOT = join(import.meta.dir, '..');

const VITE_APP_DIRS = ['apps/client', 'apps/admin'] as const;
const WRANGLER_APP_DIRS = ['apps/api', 'apps/event'] as const;

type StatePathEntry = {
  readonly source: string;
  readonly path: string;
};

const readRepoFile = (repoRelativePath: string): string =>
  readFileSync(join(REPO_ROOT, repoRelativePath), 'utf8');

const isCloudflareCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === 'cloudflare';

const findCloudflareCalls = (node: ts.Node): readonly ts.CallExpression[] => [
  ...(isCloudflareCall(node) ? [node] : []),
  ...node.getChildren().flatMap(findCloudflareCalls),
];

const propertyNamed = (
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined =>
  object.properties.find(
    (property) =>
      property.name !== undefined &&
      ts.isIdentifier(property.name) &&
      property.name.text === name,
  );

const isStringLiteralLike = (
  node: ts.Node,
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

const constStringOf = (
  source: ts.SourceFile,
  identifier: ts.Identifier,
  fail: (reason: string) => never,
): string => {
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find(
      (candidate) =>
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === identifier.text,
    );
  if (declaration === undefined) {
    return fail(`識別子${identifier.text}の宣言がファイルの最上位にありません`);
  }
  if ((ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) === 0) {
    return fail(`識別子${identifier.text}がconstで宣言されていません`);
  }
  if (
    declaration.initializer === undefined ||
    !isStringLiteralLike(declaration.initializer)
  ) {
    return fail(
      `識別子${identifier.text}の初期化子が文字列リテラルではありません`,
    );
  }
  return declaration.initializer.text;
};

const persistStatePathOf = (filePath: string, sourceText: string): string => {
  const fail = (reason: string): never => {
    throw new Error(`${filePath}の保存先を読み取れません: ${reason}`);
  };
  const source = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const calls = findCloudflareCalls(source);
  const [call] = calls;
  if (calls.length !== 1 || call === undefined) {
    return fail(
      `cloudflare()の呼び出しが1つではありません(${String(calls.length)}件)`,
    );
  }
  const [options] = call.arguments;
  if (options === undefined || !ts.isObjectLiteralExpression(options)) {
    return fail('cloudflare()の引数がオブジェクトリテラルではありません');
  }
  const persistState = propertyNamed(options, 'persistState');
  if (
    persistState === undefined ||
    !ts.isPropertyAssignment(persistState) ||
    !ts.isObjectLiteralExpression(persistState.initializer)
  ) {
    return fail('persistStateがオブジェクトリテラルで指定されていません');
  }
  const pathProperty = propertyNamed(persistState.initializer, 'path');
  if (
    pathProperty !== undefined &&
    ts.isShorthandPropertyAssignment(pathProperty)
  ) {
    return constStringOf(source, pathProperty.name, fail);
  }
  if (pathProperty === undefined || !ts.isPropertyAssignment(pathProperty)) {
    return fail('persistState.pathがありません');
  }
  const value = pathProperty.initializer;
  if (isStringLiteralLike(value)) {
    return value.text;
  }
  if (ts.isIdentifier(value)) {
    return constStringOf(source, value, fail);
  }
  return fail(
    'persistState.pathが文字列リテラルでも文字列リテラルで初期化した識別子でもありません',
  );
};

const persistToValuesOf = (
  filePath: string,
  manifestText: string,
): readonly StatePathEntry[] => {
  const manifest = JSON.parse(manifestText) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };
  return Object.entries(manifest.scripts ?? {}).flatMap(([name, script]) =>
    [...script.matchAll(/--persist-to(?:[=\s]+([^\s-]\S*))?/g)].map(
      ([, value]) => {
        if (value === undefined) {
          throw new Error(
            `${filePath}の${name}スクリプトの保存先を読み取れません: --persist-toの後に値がありません`,
          );
        }
        return { source: `${filePath}の${name}スクリプト`, path: value };
      },
    ),
  );
};

const readViteStatePath = (appDir: string): StatePathEntry => {
  const filePath = `${appDir}/vite.config.ts`;
  return {
    source: filePath,
    path: persistStatePathOf(filePath, readRepoFile(filePath)),
  };
};

const readWranglerStatePaths = (appDir: string): readonly StatePathEntry[] => {
  const filePath = `${appDir}/package.json`;
  return persistToValuesOf(filePath, readRepoFile(filePath));
};

describe('ローカル状態の保存先の読み取り', () => {
  test('persistState.pathの識別子を最上位のconstの文字列リテラルまでたどる', () => {
    const sourceText = [
      "const STATE = '/state';",
      'export default cloudflare({ persistState: { path: STATE } });',
    ].join('\n');

    expect(persistStatePathOf('vite.config.ts', sourceText)).toBe('/state');
  });

  test('persistState.pathの文字列リテラルと省略記法の識別子を読み取る', () => {
    expect(
      persistStatePathOf(
        'vite.config.ts',
        "cloudflare({ persistState: { path: '/state' } });",
      ),
    ).toBe('/state');
    expect(
      persistStatePathOf(
        'vite.config.ts',
        "const path = '/state'; cloudflare({ persistState: { path } });",
      ),
    ).toBe('/state');
  });

  test.each([
    ['cloudflare()の呼び出しが無い', 'defineConfig({});', '0件'],
    [
      'persistStateが無い',
      'cloudflare({ inspectorPort: 9231 });',
      'persistStateがオブジェクトリテラルで指定されていません',
    ],
    [
      'pathが式で組み立てられている',
      "cloudflare({ persistState: { path: join('/', 'state') } });",
      'persistState.pathが文字列リテラルでも',
    ],
    [
      '識別子がletで宣言されている',
      "let STATE = '/state'; cloudflare({ persistState: { path: STATE } });",
      '識別子STATEがconstで宣言されていません',
    ],
    [
      '識別子の初期化子が文字列リテラルでない',
      'const STATE = resolve(); cloudflare({ persistState: { path: STATE } });',
      '識別子STATEの初期化子が文字列リテラルではありません',
    ],
  ])('%sとファイルと理由を示して失敗する', (_, sourceText, reason) => {
    expect(() =>
      persistStatePathOf('apps/x/vite.config.ts', sourceText),
    ).toThrow(
      new RegExp(
        `apps/x/vite\\.config\\.tsの保存先を読み取れません: .*${reason}`,
      ),
    );
  });

  test('package.jsonのすべてのスクリプトから--persist-toの値を読み取る', () => {
    const manifestText = JSON.stringify({
      scripts: {
        dev: 'wrangler dev --persist-to /state --port 1',
        migrate: 'wrangler d1 migrations apply db --local --persist-to=/state',
        build: 'wrangler deploy --dry-run',
      },
    });

    expect(persistToValuesOf('apps/x/package.json', manifestText)).toEqual([
      { source: 'apps/x/package.jsonのdevスクリプト', path: '/state' },
      { source: 'apps/x/package.jsonのmigrateスクリプト', path: '/state' },
    ]);
  });

  test('--persist-toの後に値が無いスクリプトはファイルと理由を示して失敗する', () => {
    const manifestText = JSON.stringify({
      scripts: { dev: 'wrangler dev --persist-to --port 1' },
    });

    expect(() =>
      persistToValuesOf('apps/x/package.json', manifestText),
    ).toThrow(
      'apps/x/package.jsonのdevスクリプトの保存先を読み取れません: --persist-toの後に値がありません',
    );
  });
});

describe('ローカル状態の保存先の照合', () => {
  test.each(WRANGLER_APP_DIRS)(
    '%sのpackage.jsonのスクリプトが--persist-toを1件以上指定している',
    (appDir) => {
      expect(readWranglerStatePaths(appDir).length).toBeGreaterThan(0);
    },
  );

  test('client・adminのpersistStateとapi・eventのすべての--persist-toが同じ保存先を指す', () => {
    const entries = [
      ...VITE_APP_DIRS.map(readViteStatePath),
      ...WRANGLER_APP_DIRS.flatMap(readWranglerStatePaths),
    ];
    const [majorityPath] = Object.entries(
      Object.groupBy(entries, ({ path }) => path),
    )
      .map(([path, group = []]) => ({ path, count: group.length }))
      .toSorted((left, right) => right.count - left.count)
      .map(({ path }) => path);
    if (majorityPath === undefined) {
      throw new Error('照合する保存先がありません');
    }

    const actual = Object.fromEntries(
      entries.map(({ source, path }) => [source, path]),
    );
    const expected = Object.fromEntries(
      entries.map(({ source }) => [source, majorityPath]),
    );

    expect(actual).toEqual(expected);
  });
});
