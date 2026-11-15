import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { DIRECTORY_ITEM_METRICS } from '../../composition/directory-sections.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { DirectoryItem } from '../directory/directory-item.tsx';
import { directoryItemOf } from '../directory/directory-item-fixtures.ts';
import { MATCH_HISTORY_HEADING_ID } from '../product-page/match-history-messages.ts';

// テストのルーターがログイン中の利用者の取得を読み込むため、サーバーの実行の入口を読み込まないよう差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const LIST_PATH = '/p';

const LIST_QUERY: DirectoryQuery = { sort: 'newest', page: 1 };

const renderItemWithComments = (value: number) =>
  renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <TooltipProvider>
        <main className="bg-background p-4 text-foreground">
          <DirectoryItem
            item={directoryItemOf({ metrics: [{ key: 'comments', value }] })}
            query={LIST_QUERY}
            searchTerms={[]}
            metricRegistrations={DIRECTORY_ITEM_METRICS}
          />
        </main>
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    { path: LIST_PATH },
  );

const article = () => page.getByRole('article', { name: 'Pitch Notes' });
const commentLink = (count: string) =>
  page.getByRole('link', { name: `コメント${count}件`, exact: true });

const topmostLinkAt = (element: Element): Element | null => {
  const rect = element.getBoundingClientRect();
  return (
    document
      .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      ?.closest('a') ?? null
  );
};

afterEach(() => {
  applyColorScheme('light');
});

describe('CommentCountMetric', () => {
  test('コメント数を3桁区切りの数と吹き出しのアイコンで示し、「コメント{n}件」を名前にした詳細ページのマッチ履歴とコメントの見出しへのリンクにする', async () => {
    await renderItemWithComments(1234);

    const link = commentLink('1,234');
    await expect.element(link).toBeVisible();
    await expect
      .element(link)
      .toHaveAttribute('href', `/p/pitch-notes#${MATCH_HISTORY_HEADING_ID}`);
    const visibleText = [...link.element().children]
      .filter((child) => !child.classList.contains('sr-only'))
      .map((child) => child.textContent)
      .join('');
    expect(visibleText).toBe('1,234');
    expect(link.element().querySelector('svg')).not.toBeNull();
    expect(
      [...link.element().children].every(
        (child) =>
          child.classList.contains('sr-only') ||
          child.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(true);
  });

  test('コメントが0件のプロダクトにも「コメント0件」のリンクを描く', async () => {
    await renderItemWithComments(0);

    await expect.element(commentLink('0')).toBeVisible();
  });

  test('リンクは項目全体に広げた名称のリンクの前面にあり、押すと詳細ページのマッチ履歴とコメントの見出しへ遷移する', async () => {
    const router = await renderItemWithComments(12);

    const link = commentLink('12');
    await expect.element(link).toBeVisible();
    expect(topmostLinkAt(link.element())).toBe(link.element());

    await userEvent.click(link);

    await expect
      .poll(() => ({
        pathname: router.state.location.pathname,
        hash: router.state.location.hash,
      }))
      .toStrictEqual({
        pathname: '/p/pitch-notes',
        hash: MATCH_HISTORY_HEADING_ID,
      });
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、アクセシビリティの検査の違反が0件',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderItemWithComments(12);
      await expect.element(article()).toBeVisible();
      await expect.element(commentLink('12')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
