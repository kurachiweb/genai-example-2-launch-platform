import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { HelpArticleSkeleton } from './help-article-skeleton.tsx';

// 経路の補助が読み込む取得の部品は、サーバー専用のパッケージを読み込むため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const PC = { width: 1280, height: 800 } as const;

const MOBILE = { width: 375, height: 800 } as const;

const renderSkeleton = () =>
  renderInRouter(
    <main className="bg-background text-foreground">
      <HelpArticleSkeleton />
    </main>,
    { path: '/help/upvote-rules' },
  );

const status = () => page.getByRole('status');

const shapeOf = (name: string): DOMRect => {
  const element = document.querySelector(`[data-skeleton-part="${name}"]`);
  if (element === null) {
    throw new Error(`スケルトンの${name}が描画されていません。`);
  }
  return element.getBoundingClientRect();
};

afterEach(() => {
  applyColorScheme('light');
});

describe('HelpArticleSkeleton', () => {
  test('読み込み中であることを「ヘルプ記事を読み込み中」の状態の文言で伝え、形だけの部分を支援技術から隠す', async () => {
    await renderSkeleton();

    await expect.element(status()).toHaveTextContent('ヘルプ記事を読み込み中');
    expect(
      status().element().querySelector('[aria-hidden="true"]'),
    ).not.toBeNull();
    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .not.toBeInTheDocument();
  });

  test('読み込み中も、検索欄と「ヘルプトップへ戻る」を使える', async () => {
    const router = await renderSkeleton();

    await expect
      .element(page.getByRole('link', { name: 'ヘルプトップへ戻る' }))
      .toHaveAttribute('href', '/help');
    await userEvent.type(
      page.getByRole('searchbox', { name: '検索キーワード' }),
      'Upvote',
    );
    await userEvent.keyboard('{Enter}');

    await expect.poll(() => router.state.location.pathname).toBe('/help');
    expect(router.state.location.search).toEqual({ q: 'Upvote' });
  });

  test('PCでは、本文の形とその右側の目次の形の2カラムにする', async () => {
    await page.viewport(PC.width, PC.height);
    await renderSkeleton();
    await expect.element(status()).toBeInTheDocument();

    const body = shapeOf('body');
    const toc = shapeOf('toc');
    expect(toc.left).toBeGreaterThanOrEqual(body.right);
    expect(Math.abs(toc.top - body.top)).toBeLessThan(1);
    expect(shapeOf('header').bottom).toBeLessThanOrEqual(body.top);
  });

  test('モバイルでは、目次の形を本文の形の前に置く1カラムにする', async () => {
    await page.viewport(MOBILE.width, MOBILE.height);
    await renderSkeleton();
    await expect.element(status()).toBeInTheDocument();

    const body = shapeOf('body');
    const toc = shapeOf('toc');
    expect(toc.bottom).toBeLessThanOrEqual(body.top);
    expect(Math.abs(toc.left - body.left)).toBeLessThan(1);
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
        await renderSkeleton();
        await expect.element(status()).toBeInTheDocument();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
