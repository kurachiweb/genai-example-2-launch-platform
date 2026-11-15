import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import {
  findRawHtmlExceptions,
  findRawHtmlExceptionsInSource,
} from './raw-html-exception.ts';

const APP_DIR = join(import.meta.dirname, '..');

const RAW_HTML_EXCEPTION_PATH = 'components/markdown/markdown-content.tsx';

const RAW_HTML_RULE = '@eslint-react/dom-no-dangerously-set-innerhtml';

const kindsOf = (path: string, source: string): readonly string[] =>
  findRawHtmlExceptionsInSource(path, source).map(({ kind }) => kind);

describe('生のHTMLの例外の走査', () => {
  test('共通部品では表示部品の1行の規則の無効化だけが見つかる', async () => {
    const { scannedPaths, exceptions } = await findRawHtmlExceptions(APP_DIR);

    expect(scannedPaths).toContain(RAW_HTML_EXCEPTION_PATH);
    expect(scannedPaths).toContain('.storybook/preview.tsx');
    expect(exceptions.map(({ path, kind }) => ({ path, kind }))).toStrictEqual([
      { path: RAW_HTML_EXCEPTION_PATH, kind: 'lint-directive' },
    ]);
  });

  test('依存パッケージ・ビルドの出力・自動生成のコードを走査しない', async () => {
    const { scannedPaths } = await findRawHtmlExceptions(APP_DIR);

    expect(
      scannedPaths.filter((path) =>
        /(?:^|\/)(?:node_modules|storybook-static|coverage|generated)\/|\.gen\.ts$/u.test(
          path,
        ),
      ),
    ).toStrictEqual([]);
  });

  test('見つけた位置の行番号を1から数える', () => {
    const source = `const a = 1;\n// eslint-disable-next-line ${RAW_HTML_RULE} -- 理由\nconst b = 2;\n`;

    expect(
      findRawHtmlExceptionsInSource('components/sample.tsx', source),
    ).toStrictEqual([
      { path: 'components/sample.tsx', line: 2, kind: 'lint-directive' },
    ]);
  });

  test.each([
    `// eslint-disable-next-line ${RAW_HTML_RULE} -- 理由`,
    `const a = 1; // eslint-disable-line ${RAW_HTML_RULE}`,
    `/* eslint-disable ${RAW_HTML_RULE} */`,
    `/* eslint-disable react-x/no-leaked-conditional-rendering, ${RAW_HTML_RULE} */`,
    '// eslint-disable-next-line no-restricted-syntax -- innerHTMLへの代入',
    '// eslint-disable-next-line',
    '/* eslint-disable */',
    '/* eslint-disable -- 全ての規則 */',
    `/* eslint ${RAW_HTML_RULE}: "off" */`,
    `export const A = () => (\n  <div>\n    {/* eslint-disable-next-line ${RAW_HTML_RULE} */}\n    <p />\n  </div>\n);`,
  ])('「%s」を規則の無効化として検出する', (source) => {
    expect(kindsOf('components/sample.tsx', source)).toStrictEqual([
      'lint-directive',
    ]);
  });

  test.each([
    '// eslint-disable-next-line @typescript-eslint/only-throw-error -- 理由',
    '/* eslint-disable-next-line @eslint-react/no-array-index-key */',
    '// eslint-enable',
    '// 生のHTMLは使わない(eslint-disableしない)',
    `const text = '// eslint-disable-next-line ${RAW_HTML_RULE}';`,
    `export const A = () => <p>// eslint-disable-next-line ${RAW_HTML_RULE}</p>;`,
    `export const A = () => (\n  <p>\n    // eslint-disable-next-line ${RAW_HTML_RULE}\n  </p>\n);`,
  ])('「%s」を規則の無効化として扱わない', (source) => {
    expect(kindsOf('components/sample.tsx', source)).toStrictEqual([]);
  });

  test.each([
    ['components/sample.ts', 'const html = value as SanitizedHtml;'],
    ['components/sample.ts', 'const html = value as unknown as SanitizedHtml;'],
    ['components/sample.ts', 'const html = value as\n  SanitizedHtml;'],
    ['components/sample.ts', 'const html = <SanitizedHtml>value;'],
    [
      'components/sample.ts',
      'const html = value as SanitizedHtml | undefined;',
    ],
    [
      'components/sample.ts',
      'const list = values as readonly SanitizedHtml[];',
    ],
    ['components/sample.ts', 'const html = value as markdown.SanitizedHtml;'],
    ['components/sample.ts', 'const rendered = value as RenderedMarkdown;'],
    [
      'components/sample.ts',
      "import type { SanitizedHtml as Html } from './render-markdown.ts';",
    ],
    [
      'components/sample.ts',
      "export type { SanitizedHtml as Html } from './render-markdown.ts';",
    ],
    ['components/sample.ts', 'type Html = SanitizedHtml;'],
    ['components/sample.ts', "type Html = RenderedMarkdown['html'];"],
  ])(
    '%sの「%s」をサニタイズ済みの型への型の主張として検出する',
    (path, source) => {
      expect(kindsOf(path, source)).toStrictEqual(['sanitized-html-assertion']);
    },
  );

  test.each([
    'const html: SanitizedHtml = rendered.html;',
    'const list: readonly SanitizedHtml[] = [];',
    'type Pair = Record<string, SanitizedHtml>;',
    "import type { SanitizedHtml } from './render-markdown.ts';",
    'const html = value as SanitizedHtmlLike;',
    "const text = 'value as SanitizedHtml';",
    'const value = rendered satisfies RenderedMarkdown;',
  ])('「%s」を型の主張として扱わない', (source) => {
    expect(kindsOf('components/sample.ts', source)).toStrictEqual([]);
  });
});
