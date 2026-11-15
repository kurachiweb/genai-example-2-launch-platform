import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { hasHorizontalScroll } from '../../../lib/test/overflow.ts';
import { renderPageRouter } from '../../../test/page-router.tsx';
import type { HelpArticleView } from '../../graphql/help-center.ts';
import { HelpArticlePage } from './help-article-page.tsx';

// 経路の補助が読み込む取得の部品は、サーバー専用のパッケージを読み込むため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const PC = { width: 1280, height: 800 } as const;

const MOBILE = { width: 375, height: 800 } as const;

const PARAGRAPH =
  'Upvoteは1日に何回でもできるわけではありません。マッチごとの上限と、取り消しの扱いを確かめてください。';

// 目次のリンクで移った見出しが画面の上端に来るまでスクロールできるよう、各節を画面の高さより長くする
const SECTION = Array.from({ length: 12 }, () => [PARAGRAPH, '']).flat();

const BODY = [
  '## はじめに',
  '',
  '[公式の案内](https://outside.example/guide)と[返金の条件](https://client.example/help/refund)も読んでください。',
  '',
  ...SECTION,
  '### 回数の上限',
  '',
  ...SECTION,
  '## よくある質問',
  '',
  ...SECTION,
].join('\n');

const AUTHOR = {
  nickname: '運営チームの佐藤',
  title: 'サポート担当',
  avatar: null,
} as const satisfies HelpArticleView['author'];

const ARTICLE: HelpArticleView = {
  __typename: 'HelpArticle',
  handle: 'Upvote-Rules',
  title: 'Upvoteのルール',
  subtitle: '1日に何回Upvoteできるか',
  body: BODY,
  categoryName: '使い方',
  author: AUTHOR,
  updatedAt: '2026-11-10T09:30:00.000Z',
  relatedArticles: [
    {
      handle: 'refund',
      title: '返金の条件',
      subtitle: '返金できる場合',
      pinned: true,
    },
    {
      handle: 'account',
      title: 'アカウントの削除',
      subtitle: '退会の手順',
      pinned: false,
    },
  ],
};

const renderArticle = (article: HelpArticleView = ARTICLE) =>
  renderPageRouter({
    path: `/help/${article.handle}`,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/help',
        component: () => <p>ヘルプトップ</p>,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/help/$handle',
        component: () => <HelpArticlePage article={article} />,
      }),
    ],
  });

const main = () => page.getByRole('main');
const title = () =>
  main().getByRole('heading', { level: 1, name: 'Upvoteのルール' });
const pcToc = () => main().getByRole('navigation', { name: '目次' });
const mobileToc = () => document.querySelector<HTMLElement>('main details');
const mobileTocSummary = () =>
  document.querySelector<HTMLElement>('main summary');
const bodyOf = () =>
  document.querySelector<HTMLElement>('main [data-slot="markdown-content"]');
const headingOf = (name: string) =>
  main().getByRole('heading', { name, exact: true }).element();
const related = () => main().getByRole('region', { name: '使い方の他の記事' });

const rectOf = (element: Element | null | undefined): DOMRect => {
  if (element === null || element === undefined) {
    throw new Error('要素が描画されていません。');
  }
  return element.getBoundingClientRect();
};

const headerBottom = () => rectOf(page.getByRole('banner').element()).bottom;

afterEach(() => {
  applyColorScheme('light');
  window.scrollTo(0, 0);
});

describe('HelpArticlePage', () => {
  beforeEach(async () => {
    await page.viewport(PC.width, PC.height);
  });

  test('カテゴリ名・タイトルの見出し・サブタイトル・作成者・機械可読な値を伴う更新日時を示す', async () => {
    await renderArticle();

    await expect.element(title()).toBeVisible();
    await expect
      .element(main().getByText('使い方', { exact: true }))
      .toBeVisible();
    await expect
      .element(main().getByText('1日に何回Upvoteできるか'))
      .toBeVisible();
    await expect.element(main().getByText('運営チームの佐藤')).toBeVisible();
    await expect.element(main().getByText('サポート担当')).toBeVisible();
    const terms = [...document.querySelectorAll('main dt')].map(
      (term) => term.textContent,
    );
    expect(terms).toStrictEqual(['作成者', '更新日時']);
    const time = document.querySelector('main dd time');
    expect(time?.getAttribute('datetime')).toBe('2026-11-10T09:30:00.000Z');
    expect(time?.textContent).not.toBe('');
  });

  test('本文をマークダウンとして描き、別オリジンのリンクだけを別タブとnoopenerで開く', async () => {
    await renderArticle();
    await expect.element(title()).toBeVisible();

    expect(headingOf('はじめに').tagName).toBe('H2');
    expect(headingOf('回数の上限').tagName).toBe('H3');
    const external = main().getByRole('link', { name: '公式の案内' });
    await expect
      .element(external)
      .toHaveAttribute('href', 'https://outside.example/guide');
    await expect.element(external).toHaveAttribute('target', '_blank');
    await expect.element(external).toHaveAttribute('rel', 'noopener');
    const sameOrigin = bodyOf()?.querySelector(
      'a[href="https://client.example/help/refund"]',
    );
    expect(sameOrigin?.getAttribute('target')).toBeNull();
    expect(sameOrigin?.getAttribute('rel')).toBeNull();
  });

  test('検索欄と「ヘルプトップへ戻る」を見出しの前に置く', async () => {
    await renderArticle();
    await expect.element(title()).toBeVisible();

    const search = main().getByRole('search', { name: 'ヘルプ記事' });
    const back = main().getByRole('link', { name: 'ヘルプトップへ戻る' });
    await expect.element(search).toBeVisible();
    await expect.element(back).toHaveAttribute('href', '/help');
    expect(rectOf(search.element()).bottom).toBeLessThanOrEqual(
      rectOf(title().element()).top,
    );
    expect(rectOf(back.element()).bottom).toBeLessThanOrEqual(
      rectOf(title().element()).top,
    );
  });

  test('検索欄から検索すると、ヘルプトップの検索結果へ移る', async () => {
    const router = await renderArticle();
    await expect.element(title()).toBeVisible();

    await userEvent.type(
      main().getByRole('searchbox', { name: '検索キーワード' }),
      '返金',
    );
    await userEvent.keyboard('{Enter}');

    await expect.poll(() => router.state.location.pathname).toBe('/help');
    expect(router.state.location.search).toEqual({ q: '返金' });
  });

  test('「ヘルプトップへ戻る」でヘルプトップへ移る', async () => {
    const router = await renderArticle();

    await userEvent.click(
      main().getByRole('link', { name: 'ヘルプトップへ戻る' }),
    );

    await expect.poll(() => router.state.location.href).toBe('/help');
    await expect.element(page.getByText('ヘルプトップ')).toBeVisible();
  });

  test('同じカテゴリの記事を、本文の後にAPIが返した順のタイトルのリンクで並べる', async () => {
    await renderArticle();

    await expect.element(related()).toBeVisible();
    const links = [...related().element().querySelectorAll('li a')].map(
      (link) => [link.textContent, link.getAttribute('href')],
    );
    expect(links).toStrictEqual([
      ['返金の条件', '/help/refund'],
      ['アカウントの削除', '/help/account'],
    ]);
    expect(rectOf(related().element()).top).toBeGreaterThanOrEqual(
      rectOf(bodyOf()).bottom,
    );
  });

  test('同じカテゴリに他の公開の記事が無ければ、その区画を描かない', async () => {
    await renderArticle({ ...ARTICLE, relatedArticles: [] });
    await expect.element(title()).toBeVisible();

    await expect
      .element(main().getByRole('heading', { name: '使い方の他の記事' }))
      .not.toBeInTheDocument();
  });

  test('作成者の管理者が削除済みなら、「削除済みの管理者」を示す', async () => {
    await renderArticle({ ...ARTICLE, author: null });
    await expect.element(title()).toBeVisible();

    const author = document.querySelector('main dt + dd');
    expect(author?.textContent).toContain('削除済みの管理者');
    expect(
      author?.querySelector('[data-slot="media-placeholder"]'),
    ).not.toBeNull();
  });

  describe('PC(1280px)のとき', () => {
    test('本文と、その右側の目次の2カラムにし、折りたたみの目次を示さない', async () => {
      await renderArticle();
      await expect.element(pcToc()).toBeVisible();

      const body = rectOf(bodyOf());
      const toc = rectOf(pcToc().element());
      expect(toc.left).toBeGreaterThanOrEqual(body.right);
      expect(toc.top).toBeLessThan(body.bottom);
      expect(Math.abs(toc.top - body.top)).toBeLessThan(40);
      await expect.element(mobileTocSummary()).not.toBeVisible();
    });

    test('スクロールしても目次が共通ヘッダーの直下に留まる', async () => {
      await renderArticle();
      await expect.element(pcToc()).toBeVisible();

      window.scrollTo(0, 1500);

      await expect.poll(() => window.scrollY).toBe(1500);
      const toc = rectOf(pcToc().element());
      expect(toc.top).toBeGreaterThanOrEqual(headerBottom());
      expect(toc.top).toBeLessThan(headerBottom() + 40);
      expect(toc.bottom).toBeLessThanOrEqual(PC.height);
    });

    test('目次のリンクで、移った見出しが共通ヘッダーの下に隠れない位置で止まる', async () => {
      await renderArticle();
      await expect.element(pcToc()).toBeVisible();

      await userEvent.click(
        pcToc().getByRole('link', { name: 'よくある質問' }),
      );

      const heading = headingOf('よくある質問');
      await expect.poll(() => window.scrollY).toBeGreaterThan(0);
      await expect
        .poll(() => rectOf(heading).top)
        .toBeGreaterThanOrEqual(headerBottom());
      expect(rectOf(heading).top).toBeLessThan(headerBottom() + 48);
    });

    test('本文に見出しが無ければ目次を描かず、本文を全幅にする', async () => {
      await renderArticle({ ...ARTICLE, body: SECTION.join('\n') });
      await expect.element(title()).toBeVisible();

      expect(document.querySelector('main nav')).toBeNull();
      expect(mobileToc()).toBeNull();
      expect(rectOf(bodyOf()).width).toBeGreaterThanOrEqual(
        rectOf(title().element()).width,
      );
    });
  });

  describe('モバイル(375px)のとき', () => {
    beforeEach(async () => {
      await page.viewport(MOBILE.width, MOBILE.height);
    });

    test('1カラムにし、本文の冒頭に閉じた折りたたみの目次を置く', async () => {
      await renderArticle();
      await expect.element(mobileTocSummary()).toBeVisible();

      expect(mobileToc()?.hasAttribute('open')).toBe(false);
      await expect
        .element(main().getByRole('navigation', { name: '目次' }))
        .not.toBeInTheDocument();
      const toc = rectOf(mobileToc());
      const body = rectOf(bodyOf());
      expect(toc.bottom).toBeLessThanOrEqual(body.top);
      expect(Math.abs(toc.left - body.left)).toBeLessThan(1);
      expect(hasHorizontalScroll()).toBe(false);
    });

    test('折りたたみの目次のリンクで、移った見出しが共通ヘッダーの下に隠れない位置で止まる', async () => {
      await renderArticle();
      const summary = mobileTocSummary();
      await expect.element(summary).toBeVisible();

      await userEvent.click(summary as HTMLElement);
      await userEvent.click(main().getByRole('link', { name: 'よくある質問' }));

      const heading = headingOf('よくある質問');
      await expect.poll(() => window.scrollY).toBeGreaterThan(0);
      await expect
        .poll(() => rectOf(heading).top)
        .toBeGreaterThanOrEqual(headerBottom());
      expect(rectOf(heading).top).toBeLessThan(headerBottom() + 48);
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      { name: 'PC', ...PC },
      { name: 'モバイル', ...MOBILE },
    ])(
      '$nameで、アクセシビリティの検査の違反が0件',
      async ({ width, height }) => {
        applyColorScheme(scheme);
        await page.viewport(width, height);
        await renderArticle({
          ...ARTICLE,
          author: {
            ...AUTHOR,
            avatar: {
              id: 'media-1',
              objectKey: '0123456789abcdef0123456789abcdef',
              fallbackFormat: 'JPG',
              width: 400,
              height: 400,
            },
          },
        });
        await expect.element(title()).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
