import { describe, expect, test } from 'bun:test';

import { extractSearchText } from './extract-search-text.ts';
import type { MarkdownRenderOptions } from './markdown-options.ts';
import { renderMarkdown } from './render-markdown.ts';

const OPTIONS: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
};

const STACK_OVERFLOW_DEPTH = 20_000;

const STACK_OVERFLOW_TIMEOUT_MILLISECONDS = 30_000;

const MODULE_URL = new URL('./extract-search-text.ts', import.meta.url);

const DISPLAY_ONLY_MODULES = [
  'rehype-stringify',
  'render-markdown.ts',
  'link-policy.ts',
  'table-scroll.ts',
] as const;

const DOCUMENT = [
  '# 題',
  '## 概要',
  '本文[^1]と**太字**と[同一オリジン](https://client.example/help)と[別オリジン](https://other.example)。',
  '[相対](/help)と[スクリプト](javascript:alert(1))と[見出しへ](#概要)と www.other.example/a',
  '![図](https://img.example/a.png)と<b>太字ではない</b>',
  '| 左 | 右 |\n| - | - |\n| 1 | 2 |',
  '- [x] 済み\n- [ ] 未',
  '[^1]: 注釈',
].join('\n\n');

const transpiler = new Bun.Transpiler({ loader: 'ts' });

// 型だけの読み込みは実行時に読まれないため、Bunの走査が消すまま値の読み込みだけを辿る
const collectRuntimeImports = async (
  moduleUrl: URL,
  visited: ReadonlySet<string> = new Set(),
): Promise<ReadonlySet<string>> => {
  const specifiers = transpiler
    .scanImports(await Bun.file(moduleUrl).text())
    .map(({ path }) => path);
  const relativeUrls = specifiers
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => new URL(specifier, moduleUrl))
    .filter(({ href }) => !visited.has(href));
  const reached = new Set([
    ...visited,
    ...relativeUrls.map(({ href }) => href),
  ]);
  const nested = await Promise.all(
    relativeUrls.map(async (url) => collectRuntimeImports(url, reached)),
  );
  return new Set([...specifiers, ...nested.flatMap((imports) => [...imports])]);
};

describe('extractSearchText', () => {
  test('マークダウンの構文を除いた文字列を返す', () => {
    expect(
      extractSearchText(
        '## 見出し\n\n**太字**と*斜体*と~~消す~~と`code`と[リンク](https://site.example)',
      ),
    ).toBe('見出し\n\n太字と斜体と消すとcodeとリンク');
  });

  test('見出しレベル1・画像・Raw HTMLを表示と同じ文字列にする', () => {
    expect(
      extractSearchText(
        '# 題\n\n![図](https://img.example/a.png)\n\n<b>太字ではない</b>',
      ),
    ).toBe('# 題\n\n![図](https://img.example/a.png)\n\n<b>太字ではない</b>');
  });

  test('脚注の見出しと本文へ戻るリンクの記号を含めず、参照の番号と注釈を含める', () => {
    const text = extractSearchText('本文[^1]\n\n[^1]: 注釈');

    expect(text).toBe('本文1\n\n注釈');
    expect(text).not.toContain('脚注');
    expect(text).not.toContain('↩');
  });

  test('外されるリンクの文字列も表示と同じく残す', () => {
    expect(
      extractSearchText('[相対](/help)と[スクリプト](javascript:alert(1))'),
    ).toBe('相対とスクリプト');
  });

  test.each([
    ['既定の指定', OPTIONS],
    [
      '本文の識別子と同一オリジンのrelの指定',
      { ...OPTIONS, idScope: 'post1', sameOriginLinkRel: ['nofollow'] },
    ],
  ] as const)(
    '%sでの表示用の描画のplainTextと一致する',
    (_, options: MarkdownRenderOptions) => {
      const text = extractSearchText(DOCUMENT);

      expect(text).toBe(renderMarkdown(DOCUMENT, options).plainText);
      expect(text).toContain('# 題');
      expect(text).toContain('別オリジン');
      expect(text).not.toContain('↩');
    },
  );

  test('表示用のHTMLの文字列化とリンクの方針・表の枠を読み込まない', async () => {
    const imports = [...(await collectRuntimeImports(MODULE_URL))];

    expect(imports).toContain('./markdown-processor.ts');
    expect(
      imports.filter((specifier) =>
        DISPLAY_ONLY_MODULES.some((name) => specifier.endsWith(name)),
      ),
    ).toEqual([]);
  });

  test(
    `${STACK_OVERFLOW_DEPTH.toLocaleString('en-US')}段の引用の入れ子を例外にせず原文の文字列として返す`,
    () => {
      const markdown = `${'>'.repeat(STACK_OVERFLOW_DEPTH)} 最深`;

      expect(extractSearchText(markdown)).toBe(markdown);
    },
    STACK_OVERFLOW_TIMEOUT_MILLISECONDS,
  );
});
