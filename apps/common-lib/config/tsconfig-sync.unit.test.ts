import { describe, expect, test } from 'bun:test';

const APP_TSCONFIG_URL = new URL('../tsconfig.json', import.meta.url);
const BASE_TSCONFIG_URL = new URL(
  '../../../tsconfig.base.json',
  import.meta.url,
);

type CompilerOptions = Readonly<Record<string, unknown>>;

interface Tsconfig {
  readonly extends?: unknown;
  readonly compilerOptions?: CompilerOptions;
  readonly include?: readonly string[];
  readonly [key: string]: unknown;
}

const readTsconfig = async (url: URL): Promise<Tsconfig> =>
  (await Bun.file(url).json()) as Tsconfig;

const APP_SPECIFIC_COMPILER_OPTIONS = ['lib', 'types'] as const;

const APP_SPECIFIC_TOP_LEVEL_KEYS = ['compilerOptions', 'include'] as const;

const omitKeys = (
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Readonly<Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.includes(key)),
  );

describe('tsconfig.json', () => {
  // 共有ディレクトリとして配置先へ置かれると相対パスのextendsが解決できず、利用側アプリの変換が失敗するため
  test('基底設定を継承しない', async () => {
    const appTsconfig = await readTsconfig(APP_TSCONFIG_URL);

    expect(Object.hasOwn(appTsconfig, 'extends')).toBe(false);
  });

  test('lib・types以外のコンパイラオプションが基底設定と一致する', async () => {
    const appTsconfig = await readTsconfig(APP_TSCONFIG_URL);
    const baseTsconfig = await readTsconfig(BASE_TSCONFIG_URL);

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
    const appTsconfig = await readTsconfig(APP_TSCONFIG_URL);
    const baseTsconfig = await readTsconfig(BASE_TSCONFIG_URL);

    expect(omitKeys(appTsconfig, APP_SPECIFIC_TOP_LEVEL_KEYS)).toEqual(
      omitKeys(baseTsconfig, APP_SPECIFIC_TOP_LEVEL_KEYS),
    );
  });

  // ブラウザだけにあるAPIの使用を型検査で検出するため、DOMの型を含めない
  test('libをDOMを含まないES2024だけにし、typesにbunだけを指定する', async () => {
    const { compilerOptions } = await readTsconfig(APP_TSCONFIG_URL);

    expect(compilerOptions?.lib).toEqual(['ES2024']);
    expect(compilerOptions?.types).toEqual(['bun']);
  });

  test('共用部品の全てのTypeScriptを型検査の対象にする', async () => {
    const { include } = await readTsconfig(APP_TSCONFIG_URL);

    expect(include).toEqual(['**/*.ts']);
  });
});
