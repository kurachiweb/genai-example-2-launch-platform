import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { EDITOR_PREBUNDLED_DEPENDENCIES } from './editor-prebundled-dependencies.ts';

const EDITOR_MODULE_DIR = join(
  import.meta.dirname,
  '..',
  'components',
  'markdown-editor',
  'crepe',
);

const SOURCE_FILE = /(?<!\.(?:test|stories))\.tsx?$/;

// Reactなど画面部品の全体で使うパッケージは各設定の共通の一覧で事前バンドルするため、エディタだけが使うパッケージを対象にする
const EDITOR_PACKAGE =
  /^(?:@milkdown\/|@vue\/|vue(?:\/|$)|remark-cjk-friendly)/;

const transpiler = new Bun.Transpiler({ loader: 'tsx' });

// 型だけの読み込みは実行時に読み込まれず事前バンドルの対象にならないため、走査の前に取り除く
const valueSourceOf = (source: string): string =>
  source.replaceAll(/^import type [^;]+;$/gms, '');

const packageImportsOf = async (file: string): Promise<readonly string[]> => {
  const source = await readFile(join(EDITOR_MODULE_DIR, file), 'utf8');
  return transpiler
    .scanImports(valueSourceOf(source))
    .map(({ path }) => path)
    .filter((path) => EDITOR_PACKAGE.test(path));
};

describe('エディタの事前バンドルの一覧', () => {
  test('遅延読み込みのモジュールが実行時に読み込むエディタのパッケージの入口を全て含む', async () => {
    const files = (await readdir(EDITOR_MODULE_DIR)).filter((file) =>
      SOURCE_FILE.test(file),
    );
    const imported = new Set(
      (await Promise.all(files.map(packageImportsOf))).flat(),
    );

    expect(files.length).toBeGreaterThan(0);
    expect(
      [...imported].filter(
        (path) => !EDITOR_PREBUNDLED_DEPENDENCIES.includes(path),
      ),
    ).toEqual([]);
  });

  test('エディタの内部のUIが使うVueを含む', () => {
    expect(EDITOR_PREBUNDLED_DEPENDENCIES).toContain('vue');
  });
});
