import { describe, expect, expectTypeOf, test } from 'bun:test';

import { PATHOLOGICAL_MARKDOWN } from './fixtures/pathological-markdown.ts';
import {
  REPRESENTATIVE_MARKDOWN,
  REPRESENTATIVE_MARKDOWN_LENGTH,
} from './fixtures/representative-markdown.ts';
import type { MarkdownRenderOptions } from './markdown-options.ts';
import { DEFAULT_ID_PREFIX, MarkdownOptionsError } from './markdown-options.ts';
import { processMarkdown } from './markdown-processor.ts';
import { plainTextOf } from './plain-text.ts';
import { renderMarkdown } from './render-markdown.ts';
import type { RenderedMarkdown, SanitizedHtml } from './render-markdown.ts';

const OPTIONS: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
};

const STACK_OVERFLOW_DEPTH = 20_000;

const STACK_OVERFLOW_TIMEOUT_MILLISECONDS = 30_000;

const REPRESENTATIVE_RENDER_BUDGET_MILLISECONDS = 300;

const PATHOLOGICAL_RENDER_BUDGET_MILLISECONDS = 1_000;

const elapsedMillisecondsOf = (render: () => unknown): number => {
  const startedAt = performance.now();
  render();
  return performance.now() - startedAt;
};

const DOCUMENT = [
  '## 概要',
  '本文[^1]と[同一オリジン](https://client.example/help)と[別オリジン](https://other.example)。',
  '[メール](mailto:user@mail.example)と[見出しへ](#概要)と www.other.example/a',
  '[相対](/help)と[プロトコル相対](//evil.example)と[スクリプト](javascript:alert(1))と[データ](data:text/html,a)',
  '| 左 | 右 |\n| - | - |\n| 1 | 2 |',
  '[^1]: 注釈',
].join('\n\n');

const hrefsOf = (html: string): readonly string[] =>
  Array.from(html.matchAll(/<a\b[^>]*?\bhref="([^"]*)"/gu), ([, href]) =>
    String(href),
  );

const anchorTagsWithBlankTarget = (html: string): readonly string[] =>
  Array.from(
    html.matchAll(/<a\b[^>]*\btarget="_blank"[^>]*>/gu),
    ([tag]) => tag,
  );

// 文字列との比較のため、サニタイズ済みの型を広げて文字列として受け取る
const htmlOf = (
  markdown: string,
  options: MarkdownRenderOptions = OPTIONS,
): string => renderMarkdown(markdown, options).html;

describe('renderMarkdown', () => {
  describe('リンクの方針', () => {
    test('別オリジンのリンクだけを別のタブで開き、表示場所のrelを付ける', () => {
      const html = htmlOf(
        '[別](https://other.example) [同](https://client.example/a)',
        { ...OPTIONS, sameOriginLinkRel: ['nofollow'] },
      );

      expect(html).toBe(
        '<p><a href="https://other.example" target="_blank" rel="noopener ugc">別</a> <a href="https://client.example/a" rel="nofollow">同</a></p>',
      );
    });

    test('relの指定が空なら別オリジンのリンクにrelを付けない', () => {
      expect(
        htmlOf('[別](https://other.example)', {
          ...OPTIONS,
          externalLinkRel: [],
        }),
      ).toBe('<p><a href="https://other.example" target="_blank">別</a></p>');
    });

    test('メールアドレスとページ内のアンカーのリンクを同じタブで開く', () => {
      expect(
        htmlOf('[メール](mailto:user@mail.example) [見出し](#a)', {
          ...OPTIONS,
          sameOriginLinkRel: ['nofollow'],
        }),
      ).toBe(
        '<p><a href="mailto:user@mail.example">メール</a> <a href="#user-content-a">見出し</a></p>',
      );
    });

    test.each([
      ['相対URL', '[文字列](/help)'],
      ['プロトコル相対URL', '[文字列](//evil.example/a)'],
      ['javascript:', '[文字列](javascript:alert(1))'],
      ['data:', '[文字列](data:text/html,a)'],
      ['参照形式の相対URL', '[文字列][a]\n\n[a]: /help'],
    ])('%sのリンクを外してリンクの文字列を残す', (_, markdown) => {
      expect(htmlOf(markdown)).toBe('<p>文字列</p>');
    });

    test('target="_blank"は別オリジンのリンクだけに付き、許可外の参照のhrefが無い', () => {
      const html = htmlOf(DOCUMENT);
      const hrefs = hrefsOf(html);

      expect(
        anchorTagsWithBlankTarget(html).map(
          (tag) => /href="([^"]*)"/u.exec(tag)?.[1],
        ),
      ).toEqual(['https://other.example', 'http://www.other.example/a']);
      expect(hrefs.length).toBeGreaterThan(5);
      expect(
        hrefs.filter(
          (href) =>
            !href.startsWith('#') && !/^(?:https?:\/\/|mailto:)/u.test(href),
        ),
      ).toEqual([]);
      expect(html).toContain('<p>相対とプロトコル相対とスクリプトとデータ</p>');
    });
  });

  test('表をキーボードで移動できる名前付きの横スクロールの枠で包む', () => {
    expect(htmlOf('| a |\n| - |\n| 1 |')).toBe(
      '<div class="markdown-table-scroll" tabindex="0" role="region" aria-label="表(横にスクロールできます)"><table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>1</td>\n</tr>\n</tbody>\n</table></div>',
    );
  });

  describe('見出しの一覧', () => {
    test('脚注の見出しを除いた見出しを表示と同じIDとともに返す', () => {
      const { html, headings } = renderMarkdown(
        '## 概要\n\n### 詳細\n\n本文[^1]\n\n[^1]: 注釈',
        { ...OPTIONS, idScope: 'post1' },
      );

      expect(headings).toEqual([
        { depth: 2, id: 'user-content-post1-%E6%A6%82%E8%A6%81', text: '概要' },
        { depth: 3, id: 'user-content-post1-%E8%A9%B3%E7%B4%B0', text: '詳細' },
      ]);
      expect(headings.every(({ id }) => html.includes(`id="${id}"`))).toBe(
        true,
      );
    });
  });

  test('索引用と同じ規則のプレーンテキストを返す', () => {
    const { plainText } = renderMarkdown(DOCUMENT, OPTIONS);

    expect(plainText).toBe(
      plainTextOf(processMarkdown(DOCUMENT, DEFAULT_ID_PREFIX)),
    );
    expect(plainText).toContain('同一オリジン');
    expect(plainText).not.toContain('↩');
  });

  test('本文の識別子の接頭辞を全てのIDと#の参照に付ける', () => {
    const html = htmlOf(DOCUMENT, { ...OPTIONS, idScope: 'post1' });
    const ids = Array.from(html.matchAll(/\bid="([^"]*)"/gu), ([, id]) =>
      String(id),
    );

    expect(ids.length).toBeGreaterThan(3);
    expect(ids.filter((id) => !id.startsWith('user-content-post1-'))).toEqual(
      [],
    );
    expect(
      hrefsOf(html).filter(
        (href) =>
          href.startsWith('#') && !href.startsWith('#user-content-post1-'),
      ),
    ).toEqual([]);
  });

  test('サニタイズ済みの型で返し、他の文字列をその型として扱えない', () => {
    const rendered = renderMarkdown('本文', OPTIONS);

    expectTypeOf(rendered).toEqualTypeOf<RenderedMarkdown>();
    expectTypeOf(rendered.html).toEqualTypeOf<SanitizedHtml>();
    expectTypeOf(rendered.html).toExtend<string>();
    expectTypeOf<string>().not.toExtend<SanitizedHtml>();
    expect(htmlOf('本文')).toBe('<p>本文</p>');
  });

  test('同じ入力と指定から同じHTMLと見出しとテキストを返す', () => {
    const first = renderMarkdown(DOCUMENT, OPTIONS);
    renderMarkdown('## 別の本文', { ...OPTIONS, idScope: 'other' });

    expect(renderMarkdown(DOCUMENT, OPTIONS)).toEqual(first);
  });

  test.each([
    ['siteOrigin', { ...OPTIONS, siteOrigin: 'https://client.example/path' }],
    [
      'externalLinkRel',
      { ...OPTIONS, externalLinkRel: ['noopener', 'noopener'] },
    ],
    ['sameOriginLinkRel', { ...OPTIONS, sameOriginLinkRel: ['opener'] }],
    ['idScope', { ...OPTIONS, idScope: 'Post-1' }],
  ] as const)('%sの指定の誤りで例外を投げる', (field, options) => {
    expect(() =>
      renderMarkdown('本文', options as MarkdownRenderOptions),
    ).toThrow(MarkdownOptionsError);
    expect(() =>
      renderMarkdown('本文', options as MarkdownRenderOptions),
    ).toThrow(expect.objectContaining({ field }));
  });

  test(
    `${STACK_OVERFLOW_DEPTH.toLocaleString('en-US')}段の引用の入れ子を例外にせず原文の文字列として描画する`,
    () => {
      const markdown = `${'>'.repeat(STACK_OVERFLOW_DEPTH)} 最深`;

      const { html, headings, plainText } = renderMarkdown(markdown, OPTIONS);

      expect({ html: String(html), headings, plainText }).toEqual({
        html: `<p>${markdown}</p>`,
        headings: [],
        plainText: markdown,
      });
    },
    STACK_OVERFLOW_TIMEOUT_MILLISECONDS,
  );

  describe('性能', () => {
    test(`${REPRESENTATIVE_MARKDOWN_LENGTH.toLocaleString('en-US')}文字の代表的な文書を${String(REPRESENTATIVE_RENDER_BUDGET_MILLISECONDS)}ms以内に描画する`, () => {
      const options = { ...OPTIONS, idScope: 'post1' };
      const { headings } = renderMarkdown(REPRESENTATIVE_MARKDOWN, options);

      const elapsed = elapsedMillisecondsOf(() =>
        renderMarkdown(REPRESENTATIVE_MARKDOWN, options),
      );

      expect(REPRESENTATIVE_MARKDOWN).toHaveLength(
        REPRESENTATIVE_MARKDOWN_LENGTH,
      );
      expect(headings.length).toBeGreaterThan(50);
      expect(elapsed).toBeLessThan(REPRESENTATIVE_RENDER_BUDGET_MILLISECONDS);
    });

    test.each(
      PATHOLOGICAL_MARKDOWN.map(({ name, markdown }) => [name, markdown]),
    )(
      `解析の負荷が過大な%sを${String(PATHOLOGICAL_RENDER_BUDGET_MILLISECONDS)}ms以内に描画する`,
      (_, markdown) => {
        expect(
          elapsedMillisecondsOf(() => renderMarkdown(markdown, OPTIONS)),
        ).toBeLessThan(PATHOLOGICAL_RENDER_BUDGET_MILLISECONDS);
      },
      STACK_OVERFLOW_TIMEOUT_MILLISECONDS,
    );
  });
});
