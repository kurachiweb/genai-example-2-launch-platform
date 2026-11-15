import type { ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { HelpArticleLinkItem } from './help-article-link-item.tsx';

// 経路の補助が読み込む取得の部品は、サーバー専用のパッケージを読み込むため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const ARTICLE = Object.freeze({
  handle: 'Upvote-Rules',
  title: 'Upvoteのルール',
  subtitle: '1日に何回Upvoteできるかと、取り消しの扱い',
  pinned: false,
});

const renderInList = (item: ReactNode) =>
  renderInRouter(
    <div className="bg-background p-4 text-foreground">
      <ul>{item}</ul>
    </div>,
  );

const marksText = (): readonly string[] =>
  [...document.querySelectorAll('mark')].map(({ textContent }) => textContent);

afterEach(() => {
  applyColorScheme('light');
});

describe('HelpArticleLinkItem', () => {
  test('一覧の項目の全体を、タイトルとサブタイトルを名前に含む現在のハンドルの記事詳細へのリンクにする', async () => {
    await renderInList(<HelpArticleLinkItem article={ARTICLE} />);

    const link = page.getByRole('listitem').getByRole('link');
    await expect
      .element(link)
      .toHaveAccessibleName(
        'Upvoteのルール 1日に何回Upvoteできるかと、取り消しの扱い',
      );
    await expect.element(link).toHaveAttribute('href', '/help/Upvote-Rules');
    expect(marksText()).toStrictEqual([]);
  });

  test('ピン留めの記事には印を付け、支援技術には「ピン留め」と伝える', async () => {
    await renderInList(
      <HelpArticleLinkItem article={{ ...ARTICLE, pinned: true }} />,
    );

    await expect
      .element(page.getByRole('link'))
      .toHaveAccessibleName(
        'ピン留め Upvoteのルール 1日に何回Upvoteできるかと、取り消しの扱い',
      );
  });

  test('ピン留めでない記事には印を付けない', async () => {
    await renderInList(<HelpArticleLinkItem article={ARTICLE} />);

    await expect.element(page.getByText('ピン留め')).not.toBeInTheDocument();
  });

  test('検索語を渡すと、タイトルとサブタイトルの語の先頭から一致した部分を強調し、カテゴリ名を添える', async () => {
    await renderInList(
      <HelpArticleLinkItem
        article={ARTICLE}
        terms={['upvote', '取り消し']}
        categoryName="使い方"
      />,
    );

    expect(marksText()).toStrictEqual(['Upvote', '取り消し']);
    await expect
      .element(page.getByRole('link'))
      .toHaveAccessibleName(
        'Upvoteのルール 1日に何回Upvoteできるかと、取り消しの扱い 使い方',
      );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('ピン留めと強調とカテゴリ名を示した状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await renderInList(
        <HelpArticleLinkItem
          article={{ ...ARTICLE, pinned: true }}
          terms={['upvote']}
          categoryName="使い方"
        />,
      );
      await expect.element(page.getByRole('link')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
