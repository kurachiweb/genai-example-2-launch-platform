import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import ts from 'typescript';

const APP_DIR = join(import.meta.dirname, '..', '..');

const SRC_DIR = join(APP_DIR, 'src');

const ZOD_CONFIG_SPECIFIER = '../lib/utilities/validation/zod.ts';

// TanStack Startは既定のエントリ名をこの拡張子の順に探し、最初に見つかったファイルを使う(@tanstack/start-plugin-coreのresolve-entries)
const START_ENTRY_EXTENSIONS = [
  '.ts',
  '.js',
  '.mts',
  '.mjs',
  '.tsx',
  '.jsx',
] as const;

const ENTRIES: readonly (readonly [file: string, baseName: string])[] = [
  ['client.tsx', 'client'],
  ['server.ts', 'server'],
];

const parseSource = async (path: string): Promise<ts.SourceFile> =>
  ts.createSourceFile(
    path,
    await readFile(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

// ESモジュールは静的なimport・export … fromの記述順に依存を評価するため、その順に並べる
const moduleRequestsOf = (
  source: ts.SourceFile,
): readonly (ts.ImportDeclaration | ts.ExportDeclaration)[] =>
  source.statements.filter(
    (statement): statement is ts.ImportDeclaration | ts.ExportDeclaration =>
      ts.isImportDeclaration(statement) ||
      (ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined),
  );

const specifierOf = (
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
): string | undefined =>
  statement.moduleSpecifier !== undefined &&
  ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text
    : undefined;

const describeModuleRequest = (
  statement: ts.ImportDeclaration | ts.ExportDeclaration,
): {
  readonly kind: 'import' | 'export';
  readonly hasBindings: boolean;
  readonly specifier: string | undefined;
} =>
  ts.isImportDeclaration(statement)
    ? {
        kind: 'import',
        hasBindings: statement.importClause !== undefined,
        specifier: specifierOf(statement),
      }
    : { kind: 'export', hasBindings: true, specifier: specifierOf(statement) };

const resolveStartEntry = (baseName: string): string | undefined =>
  START_ENTRY_EXTENSIONS.map((extension) =>
    join(SRC_DIR, `${baseName}${extension}`),
  ).find((path) => existsSync(path));

const findCalls = (
  node: ts.Node,
  callee: string,
): readonly ts.CallExpression[] => [
  ...(ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === callee
    ? [node]
    : []),
  ...node.getChildren().flatMap((child) => findCalls(child, callee)),
];

const propertyNamesOf = (node: ts.Expression | undefined): readonly string[] =>
  node !== undefined && ts.isObjectLiteralExpression(node)
    ? node.properties.flatMap((property) =>
        property.name !== undefined && ts.isIdentifier(property.name)
          ? [property.name.text]
          : [],
      )
    : [];

const propertyOf = (
  node: ts.Expression | undefined,
  name: string,
): ts.Expression | undefined => {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) {
    return undefined;
  }
  const property = node.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === name,
  );
  return property?.initializer;
};

describe('ブラウザとサーバーのエントリの読み込み順', () => {
  test.each(ENTRIES)(
    '%sの最初のモジュールの読み込みは、Zodの設定の部品の束縛を持たない副作用の読み込みである',
    async (file) => {
      const source = await parseSource(join(SRC_DIR, file));

      const [first] = moduleRequestsOf(source).map(describeModuleRequest);

      expect(first).toStrictEqual({
        kind: 'import',
        hasBindings: false,
        specifier: ZOD_CONFIG_SPECIFIER,
      });
    },
  );

  test.each(ENTRIES)('%sはZodの設定の部品を1回だけ読み込む', async (file) => {
    const source = await parseSource(join(SRC_DIR, file));

    const zodRequests = moduleRequestsOf(source).filter(
      (statement) => specifierOf(statement) === ZOD_CONFIG_SPECIFIER,
    );

    expect(zodRequests).toHaveLength(1);
  });

  test.each(ENTRIES)(
    'TanStack Startは%sを既定の名前のエントリとして解決する',
    (file, baseName) => {
      expect(resolveStartEntry(baseName)).toBe(join(SRC_DIR, file));
    },
  );

  test('vite.config.tsのtanstackStartは、エントリの場所を変える設定を持たない', async () => {
    const source = await parseSource(join(APP_DIR, 'vite.config.ts'));

    const calls = findCalls(source, 'tanstackStart');

    expect(calls).toHaveLength(1);
    const [options] = calls[0]?.arguments ?? [];
    expect(propertyNamesOf(options)).not.toContain('srcDirectory');
    expect(propertyNamesOf(propertyOf(options, 'client'))).not.toContain(
      'entry',
    );
    expect(propertyNamesOf(propertyOf(options, 'server'))).not.toContain(
      'entry',
    );
  });
});
