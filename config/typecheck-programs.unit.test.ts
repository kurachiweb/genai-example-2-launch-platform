import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const REPO_ROOT = join(import.meta.dir, '..');

// 1つのプログラムではNode.jsの既定のヒープの上限を超えるため、型検査を複数のプログラムに分けるアプリ
const SPLIT_APPS = ['apps/api', 'apps/event'] as const;

const SPLIT_CONFIG_PATTERN = /^tsconfig\.typecheck\.[a-z-]+\.json$/u;

const EDITOR_CONFIG = 'tsconfig.json';

interface ParsedConfig {
  readonly fileNames: readonly string[];
  readonly options: ts.CompilerOptions;
  readonly extendsPath: string | undefined;
}

const parseConfig = (appDir: string, configName: string): ParsedConfig => {
  const path = join(appDir, configName);
  const read = ts.readConfigFile(path, (file) => ts.sys.readFile(file));
  if (read.error !== undefined) {
    throw new Error(
      ts.flattenDiagnosticMessageText(read.error.messageText, '\n'),
    );
  }
  const config: unknown = read.config;
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    appDir,
    undefined,
    path,
  );
  const extendsValue = (config as { readonly extends?: unknown }).extends;
  return {
    fileNames: parsed.fileNames,
    options: parsed.options,
    extendsPath: typeof extendsValue === 'string' ? extendsValue : undefined,
  };
};

const splitConfigsOf = (appDir: string): readonly string[] =>
  readdirSync(appDir)
    .filter((name) => SPLIT_CONFIG_PATTERN.test(name))
    .sort();

const typecheckScriptOf = (appDir: string): string => {
  const manifest = JSON.parse(
    readFileSync(join(appDir, 'package.json'), 'utf8'),
  ) as { readonly scripts?: Readonly<Record<string, string>> };
  return manifest.scripts?.typecheck ?? '';
};

const isDeclaration = (fileName: string): boolean => fileName.endsWith('.d.ts');

// コンパイラオプションのうち、設定ファイルの位置で決まる値は比べない
const comparableOptions = (
  options: ts.CompilerOptions,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(options).filter(
      ([key]) => key !== 'configFilePath' && key !== 'pathsBasePath',
    ),
  );

describe.each(SPLIT_APPS)('%sの型検査の分割', (app) => {
  const appDir = join(REPO_ROOT, app);
  const splitConfigs = splitConfigsOf(appDir);
  const editorConfig = parseConfig(appDir, EDITOR_CONFIG);
  const programs = splitConfigs.map((name) => ({
    name,
    ...parseConfig(appDir, name),
  }));

  test('分割した設定を2つ以上持つ', () => {
    expect(existsSync(appDir)).toBe(true);
    expect(splitConfigs.length).toBeGreaterThanOrEqual(2);
  });

  test('typecheckのスクリプトが分割した設定をすべて1つずつ順に検査する', () => {
    expect(typecheckScriptOf(appDir)).toBe(
      splitConfigs.map((name) => `tsc -p ${name}`).join(' && '),
    );
  });

  test('分割した設定はtsconfig.jsonを継承し、コンパイラオプションが同じになる', () => {
    for (const program of programs) {
      expect(program.extendsPath, program.name).toBe(`./${EDITOR_CONFIG}`);
      expect(comparableOptions(program.options), program.name).toEqual(
        comparableOptions(editorConfig.options),
      );
    }
  });

  test('tsconfig.jsonの宣言ファイル以外のファイルは、分割した設定のどれか1つにだけ入る', () => {
    const owners = new Map<string, string[]>();
    for (const program of programs) {
      for (const fileName of program.fileNames.filter(
        (name) => !isDeclaration(name),
      )) {
        owners.set(fileName, [...(owners.get(fileName) ?? []), program.name]);
      }
    }
    const expected = editorConfig.fileNames
      .filter((name) => !isDeclaration(name))
      .toSorted();

    expect([...owners.keys()].toSorted()).toEqual(expected);
    expect([...owners].filter(([, names]) => names.length > 1)).toStrictEqual(
      [],
    );
  });

  // 大域の型を宣言するファイルは、どのプログラムでも読み込まれなければ型が欠ける
  test('tsconfig.jsonの宣言ファイルは、分割した設定のすべてに入る', () => {
    const declarations = editorConfig.fileNames.filter(isDeclaration);

    expect(declarations.length).toBeGreaterThan(0);
    for (const program of programs) {
      expect(
        declarations.filter((name) => !program.fileNames.includes(name)),
        program.name,
      ).toStrictEqual([]);
    }
  });
});
