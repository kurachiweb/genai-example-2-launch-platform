import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { HelpArticleView } from '../../graphql/help-center.ts';
import { RelatedHelpArticles } from './related-help-articles.tsx';

// 経路の補助が読み込む取得の部品は、サーバー専用のパッケージを読み込むため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

// APIが返した順のまま並ぶことを確かめるため、タイトルの文字の順とも、ピン留めの有無の順とも異なる並びにする
const ARTICLES: HelpArticleView['relatedArticles'] = [
  {
    handle: 'Pinned-Guide',
    title: 'ピン留めの使い方',
    subtitle: 'ピン留めの記事',
    pinned: true,
  },
  {
    handle: 'refund',
    title: '返金の条件',
    subtitle: '返金できる場合',
    pinned: false,
  },
  {
    handle: 'account',
    title: 'アカウントの削除',
    subtitle: '退会の手順',
    pinned: false,
  },
];

const renderRelated = (articles: HelpArticleView['relatedArticles']) =>
  renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <RelatedHelpArticles categoryName="使い方" articles={articles} />
    </main>,
  );

const region = () => page.getByRole('region', { name: '使い方の他の記事' });

afterEach(() => {
  applyColorScheme('light');
});

describe('RelatedHelpArticles', () => {
  test('見出し「<カテゴリ名>の他の記事」の区画に、APIが返した順のまま記事のタイトルのリンクを並べる', async () => {
    await renderRelated(ARTICLES);

    await expect.element(region()).toBeVisible();
    await expect
      .element(
        region().getByRole('heading', { level: 2, name: '使い方の他の記事' }),
      )
      .toBeVisible();
    const links = [...region().element().querySelectorAll('li a')].map(
      (link) => [link.textContent, link.getAttribute('href')],
    );
    expect(links).toStrictEqual([
      ['ピン留めの使い方', '/help/Pinned-Guide'],
      ['返金の条件', '/help/refund'],
      ['アカウントの削除', '/help/account'],
    ]);
  });

  test('同じカテゴリに他の公開の記事が無ければ、区画ごと描かない', async () => {
    await renderRelated([]);
    await expect.element(page.getByRole('main')).toBeInTheDocument();
    const main = document.querySelector('main');

    expect(main?.textContent).toBe('');
    expect(main?.querySelector('section')).toBeNull();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderRelated(ARTICLES);
      await expect.element(region()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
