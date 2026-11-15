import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { ClientHelpCenterQuery } from '../../graphql/generated/graphql.ts';
import { HelpCategoryList } from './help-category-list.tsx';

// 経路の補助が読み込む取得の部品は、サーバー専用のパッケージを読み込むため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

// 並び順の規則の結果とは異なる、APIが返した順をそのまま描くことを確かめるための順
const CATEGORIES: ClientHelpCenterQuery['helpCenter'] = [
  {
    name: '料金',
    articles: [
      {
        handle: 'ultras-plan',
        title: 'Ultrasの料金',
        subtitle: '月額と年額の違い',
        pinned: false,
      },
    ],
  },
  {
    name: '使い方',
    articles: [
      {
        handle: 'week-tournament',
        title: 'Weekトーナメントの参加方法',
        subtitle: '予選から決勝までの流れ',
        pinned: false,
      },
      {
        handle: 'upvote-rules',
        title: 'Upvoteのルール',
        subtitle: '1日に何回Upvoteできるか',
        pinned: true,
      },
    ],
  },
];

const renderList = (categories: ClientHelpCenterQuery['helpCenter']) =>
  renderInRouter(
    <div className="bg-background p-4 text-foreground">
      <HelpCategoryList categories={categories} />
    </div>,
  );

const sectionEntries = () =>
  [...document.querySelectorAll('section')].map((section) => [
    section.querySelector('h2')?.textContent,
    [...section.querySelectorAll('li a')].map((link) =>
      link.getAttribute('href'),
    ),
  ]);

afterEach(() => {
  applyColorScheme('light');
});

describe('HelpCategoryList', () => {
  test('カテゴリごとにカテゴリ名を見出し(h2)にした区画を置き、カテゴリと記事をAPIが返した順のまま並べる', async () => {
    await renderList(CATEGORIES);

    await expect
      .element(page.getByRole('region', { name: '使い方' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 2, name: '料金' }))
      .toBeVisible();
    expect(sectionEntries()).toStrictEqual([
      ['料金', ['/help/ultras-plan']],
      ['使い方', ['/help/week-tournament', '/help/upvote-rules']],
    ]);
    await expect
      .element(
        page
          .getByRole('region', { name: '使い方' })
          .getByRole('link', { name: /^ピン留め Upvoteのルール/u }),
      )
      .toBeVisible();
  });

  test('公開の記事が1件も無ければ、記事がまだ無い旨と問い合わせへの導線を示す', async () => {
    await renderList([]);

    await expect
      .element(page.getByText('ヘルプ記事はまだありません。'))
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    expect(document.querySelectorAll('section h2 + ul')).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('一覧の状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderList(CATEGORIES);
      await expect
        .element(page.getByRole('region', { name: '料金' }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('0件の状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderList([]);
      await expect
        .element(page.getByText('ヘルプ記事はまだありません。'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
