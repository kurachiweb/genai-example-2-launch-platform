import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const APP_DIR = join(import.meta.dirname, '..');
const APP_TSCONFIG_PATH = join(APP_DIR, 'tsconfig.json');
const BASE_TSCONFIG_PATH = join(APP_DIR, '..', '..', 'tsconfig.base.json');

type CompilerOptions = Readonly<Record<string, unknown>>;

interface Tsconfig {
  readonly extends?: unknown;
  readonly compilerOptions?: CompilerOptions;
  readonly include?: readonly string[];
  readonly [key: string]: unknown;
}

const readTsconfig = async (path: string): Promise<Tsconfig> =>
  JSON.parse(await readFile(path, 'utf8')) as Tsconfig;

const APP_SPECIFIC_COMPILER_OPTIONS = ['jsx', 'lib', 'types'] as const;

const APP_SPECIFIC_TOP_LEVEL_KEYS = ['compilerOptions', 'include'] as const;

const omitKeys = (
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.includes(key)),
  );

describe('tsconfig.json', () => {
  // 共有ディレクトリとして配置先へ置かれると相対パスのextendsが解決できず、Viteのビルドと依存の事前解析が失敗するため
  test('基底設定を継承しない', async () => {
    const appTsconfig = await readTsconfig(APP_TSCONFIG_PATH);

    expect(Object.hasOwn(appTsconfig, 'extends')).toBe(false);
  });

  test('JSX・lib・types以外のコンパイラオプションが基底設定と一致する', async () => {
    const appTsconfig = await readTsconfig(APP_TSCONFIG_PATH);
    const baseTsconfig = await readTsconfig(BASE_TSCONFIG_PATH);

    expect(
      omitKeys(
        appTsconfig.compilerOptions ?? {},
        APP_SPECIFIC_COMPILER_OPTIONS,
      ),
    ).toEqual(
      omitKeys(
        baseTsconfig.compilerOptions ?? {},
        APP_SPECIFIC_COMPILER_OPTIONS,
      ),
    );
  });

  test('コンパイラオプションとinclude以外の設定が基底設定と一致する', async () => {
    const appTsconfig = await readTsconfig(APP_TSCONFIG_PATH);
    const baseTsconfig = await readTsconfig(BASE_TSCONFIG_PATH);

    expect(omitKeys(appTsconfig, APP_SPECIFIC_TOP_LEVEL_KEYS)).toEqual(
      omitKeys(baseTsconfig, APP_SPECIFIC_TOP_LEVEL_KEYS),
    );
  });

  test('画面部品の型検査に必要なJSXの変換とDOMの型を指定する', async () => {
    const { compilerOptions } = await readTsconfig(APP_TSCONFIG_PATH);

    expect(compilerOptions?.jsx).toBe('react-jsx');
    expect(compilerOptions?.lib).toContain('DOM');
  });
});
