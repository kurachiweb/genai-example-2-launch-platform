import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { ClientHelpArticleSearchQuery } from '../../graphql/generated/graphql.ts';
import { HelpSearchResults } from './help-search-results.tsx';

// 経路の補助が読み込む取得の部品は、サーバー専用のパッケージを読み込むため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const HITS: ClientHelpArticleSearchQuery['helpArticleSearch'] = [
  {
    handle: 'upvote-rules',
    title: 'Upvoteのルール',
    subtitle: 'Upvoteの回数と、取り消しの扱い',
    categoryName: '使い方',
  },
  {
    handle: 'refund',
    title: '返金の条件',
    subtitle: '本文だけで一致した記事',
    categoryName: '料金',
  },
];

const renderResults = (
  query: string,
  hits: ClientHelpArticleSearchQuery['helpArticleSearch'],
  refetching = false,
) =>
  renderInRouter(
    <div className="bg-background p-4 text-foreground">
      <DisplayPreferencesProvider
        initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
      >
        <HelpSearchResults query={query} hits={hits} refetching={refetching} />
      </DisplayPreferencesProvider>
    </div>,
    { path: `/help?q=${encodeURIComponent(query)}` },
  );

const itemEntries = () =>
  [...document.querySelectorAll('li a')].map((link) => [
    link.getAttribute('href'),
    [...link.querySelectorAll('mark')].map(({ textContent }) => textContent),
  ]);

afterEach(() => {
  applyColorScheme('light');
});

describe('HelpSearchResults', () => {
  test('見出し「「<検索語>」の検索結果」と件数の下に、APIが返した順のまま記事をカテゴリ名付きで並べる', async () => {
    await renderResults('Upvote', HITS);

    await expect
      .element(page.getByRole('heading', { level: 2 }))
      .toHaveTextContent('「Upvote」の検索結果');
    await expect.element(page.getByText('2件')).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: /返金の条件/u }))
      .toHaveAccessibleName('返金の条件 本文だけで一致した記事 料金');
    expect(itemEntries()).toStrictEqual([
      ['/help/upvote-rules', ['Upvote', 'Upvote']],
      ['/help/refund', []],
    ]);
  });

  test('空白で区切った検索語の語ごとに、タイトルとサブタイトルの語の先頭から一致した部分を大文字小文字・全角半角を問わず強調する', async () => {
    await renderResults('ｕｐｖｏｔｅ 取り消し', HITS.slice(0, 1));

    expect(itemEntries()).toStrictEqual([
      ['/help/upvote-rules', ['Upvote', 'Upvote', '取り消し']],
    ]);
  });

  test('一致する記事が無ければ、該当する記事が無い旨と、カテゴリ別の一覧へ戻る導線を示す', async () => {
    await renderResults('存在しない語', []);

    await expect
      .element(
        page.getByText('「存在しない語」に一致するヘルプ記事はありません。'),
      )
      .toBeVisible();
    const back = page.getByRole('link', { name: 'すべてのヘルプ記事を見る' });
    await expect.element(back).toHaveAttribute('href', '/help');
    await expect.element(back).not.toHaveAttribute('aria-current');
    await expect.element(page.getByText(/件$/u)).not.toBeInTheDocument();
  });

  test('再読み込みの間は、件数を「読み込み中…」と読み上げ、直前の結果をinert・aria-busyで残す', async () => {
    await renderResults('Upvote', HITS, true);

    const count = page.getByText('読み込み中…');
    await expect.element(count).toHaveAttribute('aria-live', 'polite');
    await expect.element(count).toHaveAttribute('aria-atomic', 'true');
    const list = document.querySelector('li')?.closest('ul');
    expect(list?.closest('[inert]')).not.toBeNull();
    expect(list?.closest('[aria-busy="true"]')).not.toBeNull();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('再読み込みが終われば、件数を示して操作の停止を解く', async () => {
    await renderResults('Upvote', HITS);

    await expect.element(page.getByText('2件')).toBeVisible();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('[aria-busy]')).toBeNull();
  });

  test('0件の再読み込みの間も、直前の案内をinert・aria-busyで残す', async () => {
    await renderResults('存在しない語', [], true);

    const back = page.getByRole('link', { name: 'すべてのヘルプ記事を見る' });
    await expect.element(back).toBeInTheDocument();
    expect(
      document.querySelector('[inert] [data-slot="empty-state"]'),
    ).not.toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('結果の状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderResults('Upvote', HITS);
      await expect.element(page.getByText('2件')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('0件の状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderResults('存在しない語', []);
      await expect
        .element(page.getByRole('link', { name: 'すべてのヘルプ記事を見る' }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
