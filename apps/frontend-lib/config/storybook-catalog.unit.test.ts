import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const APP_DIR = join(import.meta.dirname, '..');

const COMPONENT_FILES = new Bun.Glob('components/**/*.tsx');

const STORY_FILES = new Bun.Glob('components/**/*.stories.tsx');

const CATALOG_PREVIEW_FILE = '.storybook/preview.tsx';

const NON_COMPONENT_SUFFIXES = ['.browser.test.tsx', '.stories.tsx'];

// カタログに載せられない部品と、その理由
const CATALOG_EXCLUSIONS: Readonly<Record<string, string>> = {
  'components/app-shell/app-document.tsx':
    'html要素から描画する文書の外枠で、カタログの枠の中に置けないため、中身の部品を個別に載せる',
  'components/datetime/display-preferences-provider.tsx':
    '表示を持たず、カタログではブラウザの値に切り替えない固定の表示設定を文脈へ直接渡すため',
};

interface InternalComponent {
  readonly parent: string;
  readonly reason: string;
}

// 親の部品の中でだけ描画される部品と、それを描画する親の部品。親のストーリーで表示される
const INTERNAL_COMPONENTS: Readonly<Record<string, InternalComponent>> = {
  'components/form/form-message.tsx': {
    parent: 'components/form/form-field.tsx',
    reason: '欄のエラーの表示として欄の部品の中で描画する',
  },
  'components/ui/dialog/dialog-overlay.tsx': {
    parent: 'components/ui/dialog/dialog-content.tsx',
    reason: 'ダイアログの本体が背景の覆いとして描画する',
  },
  'components/ui/dialog/dialog-portal.tsx': {
    parent: 'components/ui/dialog/dialog-content.tsx',
    reason: 'ダイアログの本体が文書の末尾へ描画するために使う',
  },
  'components/ui/sheet/sheet-overlay.tsx': {
    parent: 'components/ui/sheet/sheet-content.tsx',
    reason: 'シートの本体が背景の覆いとして描画する',
  },
  'components/ui/sheet/sheet-portal.tsx': {
    parent: 'components/ui/sheet/sheet-content.tsx',
    reason: 'シートの本体が文書の末尾へ描画するために使う',
  },
};

const TRANSPILERS = {
  ts: new Bun.Transpiler({ loader: 'ts' }),
  tsx: new Bun.Transpiler({ loader: 'tsx' }),
};

const scanAll = (glob: Bun.Glob): string[] => [
  ...glob.scanSync({ cwd: APP_DIR }),
];

const relativeImportsOf = async (file: string): Promise<string[]> => {
  const source = await readFile(join(APP_DIR, file), 'utf8');
  return TRANSPILERS[file.endsWith('.tsx') ? 'tsx' : 'ts']
    .scanImports(source)
    .map(({ path }) => path)
    .filter((path) => path.startsWith('.'))
    .map((path) => relative(APP_DIR, resolve(APP_DIR, dirname(file), path)));
};

// 他の部品のストーリーの中で描画されるだけでは個別の状態を載せたことにならないため、同じディレクトリのストーリーが直接読み込む部品と、カタログの全体の設定が直接読み込む部品だけを掲載済みとする
const catalogImports = async (): Promise<Set<string>> => {
  const storyImports = await Promise.all(
    scanAll(STORY_FILES).map(async (story) =>
      (await relativeImportsOf(story)).filter(
        (file) => dirname(file) === dirname(story),
      ),
    ),
  );
  return new Set([
    ...storyImports.flat(),
    ...(await relativeImportsOf(CATALOG_PREVIEW_FILE)),
  ]);
};

describe('部品のカタログ', () => {
  test('ドットで始まるカタログの設定のディレクトリを型検査に含める', async () => {
    const tsconfig = JSON.parse(
      await readFile(join(APP_DIR, 'tsconfig.json'), 'utf8'),
    ) as { readonly include?: readonly string[] };

    expect(tsconfig.include).toContain('.storybook/**/*.ts');
    expect(tsconfig.include).toContain('.storybook/**/*.tsx');
  });

  test('起動とビルドのスクリプトを持つ', async () => {
    const packageJson = JSON.parse(
      await readFile(join(APP_DIR, 'package.json'), 'utf8'),
    ) as { readonly scripts?: Readonly<Record<string, string>> };

    expect(packageJson.scripts).toMatchObject({
      'storybook:dev': 'storybook dev',
      'storybook:build': 'storybook build',
    });
  });

  test('除外した部品と内部の部品を除く全ての部品を、同じディレクトリのストーリーかカタログの全体の設定が直接読み込む', async () => {
    const componentFiles = scanAll(COMPONENT_FILES).filter(
      (file) =>
        !NON_COMPONENT_SUFFIXES.some((suffix) => file.endsWith(suffix)) &&
        !Object.hasOwn(CATALOG_EXCLUSIONS, file) &&
        !Object.hasOwn(INTERNAL_COMPONENTS, file),
    );
    const imported = await catalogImports();

    expect(componentFiles.filter((file) => !imported.has(file))).toEqual([]);
  });

  test('内部の部品は、掲載済みの親の部品の中で使われる', async () => {
    const imported = await catalogImports();
    const unrendered: string[] = [];
    for (const [file, { parent }] of Object.entries(INTERNAL_COMPONENTS)) {
      const parentImports = await relativeImportsOf(parent);
      if (!imported.has(parent) || !parentImports.includes(file)) {
        unrendered.push(file);
      }
    }

    expect(unrendered).toEqual([]);
  });

  test('除外した部品と内部の部品は実在する', () => {
    const componentFiles = new Set(scanAll(COMPONENT_FILES));

    expect(
      [
        ...Object.keys(CATALOG_EXCLUSIONS),
        ...Object.keys(INTERNAL_COMPONENTS),
      ].filter((file) => !componentFiles.has(file)),
    ).toEqual([]);
  });
});
