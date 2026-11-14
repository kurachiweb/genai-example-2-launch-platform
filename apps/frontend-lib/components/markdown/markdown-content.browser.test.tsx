import axe from 'axe-core';
import { act, type ReactElement } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import {
  type RenderedMarkdown,
  renderMarkdown,
} from '../../../common-lib/markdown/render-markdown.ts';
import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  computedColorOf,
  tokenColorOf,
} from '../../test/computed-style.ts';
import { MarkdownContent } from './markdown-content.tsx';

const SITE_ORIGIN = 'https://client.example';

const TABLE_REGION_NAME = '表(横にスクロールできます)';

const TYPOGRAPHY_SAMPLE = [
  '## 大会の見出し',
  '',
  '本文の段落と[同じサイトのリンク](https://client.example/p/launch)と[外部のリンク](https://other.example/docs)と`インラインのコード`。',
  '',
  '> 引用の文',
  '',
  '```ts',
  'const answer = 42;',
  '```',
  '',
  '| 項目 | 説明 |',
  '| --- | --- |',
  '| 投票 | 1日1回まで |',
  '',
  '- [ ] 未完了の項目',
  '- [x] 完了した項目',
  '',
  '脚注付きの文[^1]。',
  '',
  '[^1]: 脚注の本文。',
].join('\n');

const WIDE_TABLE = [
  '| 見出しの長い列その1 | 見出しの長い列その2 | 見出しの長い列その3 | 見出しの長い列その4 |',
  '| --- | --- | --- | --- |',
  '| Internationalization | Accessibility | Localization | Documentation |',
].join('\n');

const renderSample = (markdown: string): RenderedMarkdown =>
  renderMarkdown(markdown, {
    siteOrigin: SITE_ORIGIN,
    externalLinkRel: ['noopener', 'ugc'],
  });

const DEFAULT_VIEWPORT = { width: 414, height: 896 } as const;

const WIDE_VIEWPORT = { width: 1024, height: 768 } as const;

const contentOf = (container: HTMLElement): HTMLElement => {
  const content = container.querySelector<HTMLElement>(
    '[data-slot="markdown-content"]',
  );
  if (content === null) {
    throw new Error('表示部品が描画されていません。');
  }
  return content;
};

const elementOf = (root: Element, selector: string): HTMLElement => {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`${selector}が描画されていません。`);
  }
  return element;
};

// ブラウザは文字列化の時に真偽値の属性へ空の値を補うため、同じ経路で解析し直した表記で比べる
const normalizedHtmlOf = (html: string): string =>
  new DOMParser().parseFromString(html, 'text/html').body.innerHTML;

const pseudoContentOf = (element: Element, pseudo: string): string =>
  getComputedStyle(element, pseudo).content;

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const actEnvironment = globalThis as ActEnvironment;

const hydratedRoots: Root[] = [];

// vitest-browser-reactのrenderは自分のactの後にactの環境の指定を戻すため、Reactのactを直接呼ぶたびに指定し直す
async function actInTestEnvironment(
  callback: () => Promise<void>,
): Promise<void> {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(callback);
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  }
}

interface HydratedMarkup {
  readonly container: HTMLElement;
  readonly serverHtml: string;
  readonly recoverableErrors: readonly unknown[];
}

async function hydrateServerMarkup(ui: ReactElement): Promise<HydratedMarkup> {
  const recoverableErrors: unknown[] = [];
  const serverHtml = renderToString(ui);
  const container = document.body.appendChild(document.createElement('div'));
  container.replaceChildren(
    ...new DOMParser().parseFromString(serverHtml, 'text/html').body.childNodes,
  );
  await actInTestEnvironment(async () => {
    hydratedRoots.push(
      hydrateRoot(container, ui, {
        onRecoverableError: (error) => {
          recoverableErrors.push(error);
        },
      }),
    );
    await Promise.resolve();
  });
  return { container, serverHtml, recoverableErrors };
}

afterEach(async () => {
  await actInTestEnvironment(async () => {
    for (const root of hydratedRoots.splice(0)) {
      root.unmount();
    }
    await Promise.resolve();
  });
  document.body.replaceChildren();
  applyColorScheme('light');
  await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
});

describe('MarkdownContent', () => {
  test('描画済みのHTMLを本文の枠の中にそのまま表示する', async () => {
    const rendered = renderSample(TYPOGRAPHY_SAMPLE);
    const { container } = await render(<MarkdownContent rendered={rendered} />);

    expect(contentOf(container).innerHTML).toBe(
      normalizedHtmlOf(rendered.html),
    );
    await expect
      .element(page.getByRole('heading', { level: 2, name: '大会の見出し' }))
      .toBeVisible();
  });

  test('呼び出し側のクラスを本文の枠に加える', async () => {
    const { container } = await render(
      <MarkdownContent
        rendered={renderSample('本文')}
        className="mt-4 text-left"
      />,
    );

    const content = contentOf(container);
    expect(content.classList).toContain('mt-4');
    expect(content.classList).toContain('prose');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <MarkdownContent rendered={renderSample(TYPOGRAPHY_SAMPLE)} />,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('本文の色を配色に合わせ、リンクは主色で表示する', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <MarkdownContent rendered={renderSample(TYPOGRAPHY_SAMPLE)} />,
      );

      const content = contentOf(container);
      const bodyColorVariable =
        scheme === 'dark' ? '--tw-prose-invert-body' : '--tw-prose-body';
      const expectedBodyColor = computedColorOf(
        getComputedStyle(content).getPropertyValue(bodyColorVariable),
      );
      expect(getComputedStyle(elementOf(content, 'p')).color).toBe(
        expectedBodyColor,
      );
      expect(getComputedStyle(elementOf(content, 'a')).color).toBe(
        tokenColorOf('primary'),
      );
    });

    test('コードブロックを専用の配色で表示する', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <MarkdownContent rendered={renderSample(TYPOGRAPHY_SAMPLE)} />,
      );

      const pre = elementOf(contentOf(container), 'pre');
      expect(getComputedStyle(pre).backgroundColor).toBe(
        tokenColorOf('code-block'),
      );
      expect(getComputedStyle(pre).color).toBe(
        tokenColorOf('code-block-foreground'),
      );
      expect(getComputedStyle(pre).overflowX).toBe('auto');
    });
  });

  test('見出しを太字で詰めて表示する', async () => {
    const { container } = await render(
      <MarkdownContent rendered={renderSample(TYPOGRAPHY_SAMPLE)} />,
    );

    const heading = elementOf(contentOf(container), 'h2');
    expect(getComputedStyle(heading).fontWeight).toBe('800');
    expect(getComputedStyle(heading).letterSpacing).not.toBe('normal');
  });

  test('引用とコードに入力に無い引用符・バッククォートを付けない', async () => {
    const { container } = await render(
      <MarkdownContent rendered={renderSample(TYPOGRAPHY_SAMPLE)} />,
    );

    const content = contentOf(container);
    const quote = elementOf(content, 'blockquote p');
    const code = elementOf(content, 'p code');
    expect(pseudoContentOf(quote, '::before')).toBe('none');
    expect(pseudoContentOf(quote, '::after')).toBe('none');
    expect(pseudoContentOf(code, '::before')).toBe('none');
    expect(pseudoContentOf(code, '::after')).toBe('none');
    expect(getComputedStyle(elementOf(content, 'blockquote')).fontStyle).toBe(
      'normal',
    );
  });

  test('インラインのコードは淡い背景で表示する', async () => {
    const { container } = await render(
      <MarkdownContent rendered={renderSample(TYPOGRAPHY_SAMPLE)} />,
    );

    const code = elementOf(contentOf(container), 'p code');
    expect(getComputedStyle(code).backgroundColor).toBe(tokenColorOf('muted'));
  });

  test('タスクリストは行頭の記号を付けずにチェックボックスを並べる', async () => {
    const { container } = await render(
      <MarkdownContent rendered={renderSample(TYPOGRAPHY_SAMPLE)} />,
    );

    const list = elementOf(contentOf(container), 'ul.contains-task-list');
    expect(getComputedStyle(list).listStyleType).toBe('none');
    expect(
      Number.parseFloat(
        getComputedStyle(elementOf(list, 'input[type="checkbox"]'))
          .marginInlineEnd,
      ),
    ).toBeGreaterThan(0);
  });

  test('脚注の見出しを画面に表示せず支援技術へ伝える', async () => {
    const { container } = await render(
      <MarkdownContent rendered={renderSample(TYPOGRAPHY_SAMPLE)} />,
    );

    const heading = elementOf(contentOf(container), '.footnotes h2');
    const { width, height } = heading.getBoundingClientRect();
    expect(getComputedStyle(heading).position).toBe('absolute');
    expect(width).toBeLessThanOrEqual(1);
    expect(height).toBeLessThanOrEqual(1);
    await expect
      .element(page.getByRole('heading', { level: 2, name: '脚注' }))
      .toBeInTheDocument();
  });

  describe('大きさ', () => {
    test('既定の大きさは狭い画面で小さく、640px以上で標準の文字の大きさにする', async () => {
      const { container } = await render(
        <MarkdownContent rendered={renderSample('本文')} />,
      );
      const paragraph = elementOf(contentOf(container), 'p');

      expect(getComputedStyle(paragraph).fontSize).toBe('14px');

      await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);

      expect(getComputedStyle(paragraph).fontSize).toBe('16px');
    });

    test('小さい大きさは画面の幅によらず小さい文字にする', async () => {
      await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
      const { container } = await render(
        <MarkdownContent rendered={renderSample('本文')} size="sm" />,
      );

      expect(
        getComputedStyle(elementOf(contentOf(container), 'p')).fontSize,
      ).toBe('14px');
    });
  });

  describe('表', () => {
    test('列揃えを指定した列は見出しとセルをその向きに揃え、指定の無い列は左に揃える', async () => {
      const { container } = await render(
        <MarkdownContent
          rendered={renderSample(
            [
              '| 指定なし | 左 | 中央 | 右 |',
              '| --- | :-- | :-: | --: |',
              '| a | b | c | d |',
            ].join('\n'),
          )}
        />,
      );

      const table = elementOf(contentOf(container), 'table');
      const alignmentsOf = (selector: string): readonly string[] =>
        Array.from(
          table.querySelectorAll(selector),
          (cell) => getComputedStyle(cell).textAlign,
        );
      expect(alignmentsOf('th')).toStrictEqual([
        'left',
        'left',
        'center',
        'right',
      ]);
      expect(alignmentsOf('td')).toStrictEqual([
        'start',
        'left',
        'center',
        'right',
      ]);
    });

    test('単語の途中で折り返さず、表の枠の中だけを横にスクロールさせる', async () => {
      const { container } = await render(
        <div className="w-64">
          <MarkdownContent rendered={renderSample(WIDE_TABLE)} />
        </div>,
      );

      const content = contentOf(container);
      const scroll = elementOf(content, '.markdown-table-scroll');
      const table = elementOf(content, 'table');
      expect(getComputedStyle(scroll).overflowX).toBe('auto');
      expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
      expect(content.scrollWidth).toBe(content.clientWidth);
      expect(getComputedStyle(table).overflowWrap).toBe('normal');
      expect(getComputedStyle(elementOf(table, 'th')).whiteSpace).toBe(
        'nowrap',
      );
      expect(getComputedStyle(elementOf(table, 'td')).minWidth).toBe('112px');
    });

    test('表の枠へキーボードで移動し、矢印キーで横にスクロールできる', async () => {
      await render(
        <div className="w-64">
          <MarkdownContent rendered={renderSample(WIDE_TABLE)} />
        </div>,
      );
      const region = page.getByRole('region', { name: TABLE_REGION_NAME });

      await userEvent.tab();

      await expect.element(region).toHaveFocus();
      const scroll = region.element();
      expect(scroll.scrollLeft).toBe(0);

      await userEvent.keyboard('{ArrowRight}');

      await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0);
    });

    test('表の枠のフォーカスの輪郭を表示する', async () => {
      await render(<MarkdownContent rendered={renderSample(WIDE_TABLE)} />);

      await userEvent.tab();

      const region = page
        .getByRole('region', { name: TABLE_REGION_NAME })
        .element();
      expect(getComputedStyle(region).outlineStyle).toBe('solid');
      expect(getComputedStyle(region).outlineColor).toBe(tokenColorOf('ring'));
    });

    test('複数の表は同じ名前の領域になり、WCAGの規則の違反は0件で、ベストプラクティスの領域の名前の重複だけが報告される', async () => {
      const { container } = await render(
        <MarkdownContent
          rendered={renderSample(`${WIDE_TABLE}\n\n本文\n\n${WIDE_TABLE}`)}
        />,
      );

      expect(
        page.getByRole('region', { name: TABLE_REGION_NAME }).elements(),
      ).toHaveLength(2);
      expect(await runAxe(container)).toStrictEqual([]);
      const { violations } = await axe.run(container, {
        runOnly: { type: 'rule', values: ['landmark-unique'] },
      });
      expect(violations.map(({ id }) => id)).toStrictEqual(['landmark-unique']);
    });

    test('表が1つなら領域の名前の重複は報告されない', async () => {
      const { container } = await render(
        <MarkdownContent rendered={renderSample(WIDE_TABLE)} />,
      );

      const { violations } = await axe.run(container, {
        runOnly: { type: 'rule', values: ['landmark-unique'] },
      });
      expect(violations).toHaveLength(0);
    });
  });

  test('ページのサーバー側の描画とブラウザの初期化で同じHTMLになり、食い違いを起こさない', async () => {
    const rendered = renderSample(TYPOGRAPHY_SAMPLE);

    const { container, serverHtml, recoverableErrors } =
      await hydrateServerMarkup(<MarkdownContent rendered={rendered} />);

    expect(recoverableErrors).toStrictEqual([]);
    expect(container.innerHTML).toBe(normalizedHtmlOf(serverHtml));
    expect(contentOf(container).innerHTML).toBe(
      normalizedHtmlOf(rendered.html),
    );
  });

  test('描画部品の結果以外の文字列は型で受け付けない', () => {
    const forged = { html: '<script></script>', headings: [], plainText: '' };

    // @ts-expect-error 描画部品だけが作れるサニタイズ済みの型を要求する
    const element = <MarkdownContent rendered={forged} />;

    expect(element.type).toBe(MarkdownContent);
  });
});
