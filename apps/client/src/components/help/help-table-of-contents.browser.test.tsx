import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import type { MarkdownHeading } from '../../../common-lib/markdown/render-markdown.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { HelpTableOfContents } from './help-table-of-contents.tsx';

const PC = { width: 1280, height: 800 } as const;

const MOBILE = { width: 375, height: 800 } as const;

// 同じ文字列の見出しは描画で末尾の番号だけが異なるIDになるため、2つ目の「設定」で`id`をキーにしていることを確かめる
const HEADINGS: readonly MarkdownHeading[] = [
  { depth: 2, id: 'user-content-article-はじめに', text: 'はじめに' },
  { depth: 3, id: 'user-content-article-設定', text: '設定' },
  { depth: 4, id: 'user-content-article-詳細な設定', text: '詳細な設定' },
  { depth: 3, id: 'user-content-article-設定-1', text: '設定' },
  { depth: 2, id: 'user-content-article-よくある質問', text: 'よくある質問' },
];

const EXPECTED_LINKS = HEADINGS.map(({ id, text }) => [text, `#${id}`]);

const renderToc = (headings: readonly MarkdownHeading[]) =>
  render(
    <div className="bg-background p-4 text-foreground">
      <HelpTableOfContents headings={headings} />
    </div>,
  );

const pcNavigation = () => page.getByRole('navigation', { name: '目次' });

const mobileDisclosure = () => document.querySelector('details');

const mobileSummary = () => {
  const summary = document.querySelector('summary');
  if (summary === null) {
    throw new Error('折りたたみの見出しが描かれていない');
  }
  return summary;
};

const linksIn = (root: Element | null) =>
  [...(root?.querySelectorAll('a') ?? [])].map((link) => [
    link.textContent,
    link.getAttribute('href'),
  ]);

const linkLefts = (root: Element) =>
  HEADINGS.map(
    ({ id }) =>
      [...root.querySelectorAll('a')]
        .find((link) => link.getAttribute('href') === `#${id}`)
        ?.getBoundingClientRect().left ?? Number.NaN,
  );

const expectIndentedByDepth = (root: Element) => {
  const [h2, h3, h4, h3Again, h2Again] = linkLefts(root);
  expect(h3).toBeGreaterThan(h2 ?? Number.NaN);
  expect(h4).toBeGreaterThan(h3 ?? Number.NaN);
  expect(h3Again).toBe(h3);
  expect(h2Again).toBe(h2);
};

afterEach(() => {
  applyColorScheme('light');
});

describe('HelpTableOfContents', () => {
  describe('PC(1280px)のとき', () => {
    beforeEach(async () => {
      await page.viewport(PC.width, PC.height);
    });

    test('「目次」の名前のナビゲーションに、見出しのIDへのリンクを本文の順に並べ、折りたたみを示さない', async () => {
      await renderToc(HEADINGS);

      await expect.element(pcNavigation()).toBeVisible();
      expect(linksIn(pcNavigation().element())).toStrictEqual(EXPECTED_LINKS);
      await expect
        .element(pcNavigation().getByRole('link', { name: 'よくある質問' }))
        .toHaveAttribute('href', '#user-content-article-よくある質問');
      await expect.element(mobileSummary()).not.toBeVisible();
    });

    test('見出しの深さに応じて項目を字下げする', async () => {
      await renderToc(HEADINGS);
      await expect.element(pcNavigation()).toBeVisible();

      expectIndentedByDepth(pcNavigation().element());
    });

    test('スクロールに追従して共通ヘッダーの下に留まる固定の配置にする', async () => {
      await renderToc(HEADINGS);
      await expect.element(pcNavigation()).toBeVisible();

      const style = getComputedStyle(pcNavigation().element());
      expect(style.position).toBe('sticky');
      expect(Number.parseFloat(style.top)).toBeGreaterThanOrEqual(56);
    });
  });

  describe('モバイル(375px)のとき', () => {
    beforeEach(async () => {
      await page.viewport(MOBILE.width, MOBILE.height);
    });

    test('「目次」の見出しの閉じた折りたたみを示し、PC用のナビゲーションを示さない', async () => {
      await renderToc(HEADINGS);

      const summary = mobileSummary();
      await expect.element(summary).toBeVisible();
      expect(summary.textContent).toBe('目次');
      expect(mobileDisclosure()?.open).toBe(false);
      await expect
        .element(page.getByRole('link', { name: 'はじめに' }))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByRole('navigation', { name: '目次' }))
        .not.toBeInTheDocument();
    });

    test('折りたたみを開くと、見出しのIDへのリンクが本文の順に深さに応じた字下げで並ぶ', async () => {
      await renderToc(HEADINGS);
      const summary = mobileSummary();
      await expect.element(summary).toBeVisible();

      await userEvent.click(summary);

      await expect
        .element(page.getByRole('link', { name: 'はじめに' }))
        .toBeVisible();
      const disclosure = mobileDisclosure();
      expect(disclosure?.open).toBe(true);
      expect(linksIn(disclosure)).toStrictEqual(EXPECTED_LINKS);
      expectIndentedByDepth(disclosure as Element);
    });

    test('キーボードで折りたたみを開ける', async () => {
      await renderToc(HEADINGS);
      await expect.element(mobileSummary()).toBeVisible();

      await userEvent.tab();
      expect(document.activeElement).toBe(mobileSummary());
      await userEvent.keyboard('{Enter}');

      await expect
        .element(page.getByRole('link', { name: 'はじめに' }))
        .toBeVisible();
    });
  });

  test.each([
    { name: 'PC', ...PC },
    { name: 'モバイル', ...MOBILE },
  ])('$nameで、見出しが無いときは何も描かない', async ({ width, height }) => {
    await page.viewport(width, height);
    const { container } = await renderToc([]);

    expect(container.querySelector('nav')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toBe('');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('PCで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await page.viewport(PC.width, PC.height);
      await renderToc(HEADINGS);
      await expect.element(pcNavigation()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('モバイルで、閉じた状態と開いた状態のアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await page.viewport(MOBILE.width, MOBILE.height);
      await renderToc(HEADINGS);
      const summary = mobileSummary();
      await expect.element(summary).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(summary);
      await expect
        .element(page.getByRole('link', { name: 'はじめに' }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
