import { createRoute, notFound } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  focusMainContent,
  GUEST_VIEWER_QUERY,
  renderPageRouter,
} from '../../../test/page-router.tsx';
import {
  signedInViewerQuery,
  VIEWER_NICKNAME,
} from '../../../test/viewer-fixtures.ts';
import type { ClientViewerQuery } from '../../graphql/generated/graphql.ts';

// ログイン中の利用者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える。利用者は取得のキャッシュに先に入れる
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const NOT_FOUND_TITLE = 'ページが見つかりません。';
const NOT_FOUND_DESCRIPTION =
  'お探しのページは見つかりませんでした。URLをご確認ください。';

const NOT_FOUND_LINKS = [
  ['トップページへ', '/'],
  ['ディレクトリを見る', '/p'],
] as const;

const main = () => page.getByRole('main');

const renderUnknownPath = (
  cachedViewer: ClientViewerQuery = GUEST_VIEWER_QUERY,
) =>
  renderPageRouter({
    path: '/no-such-page',
    cachedViewer,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <h1>トップページ</h1>,
      }),
    ],
  });

// ヘッダーの区画は幅768px以上でだけヘッダーに見えるため、確かめるテストだけ幅を広げ、後のテストのために既定の幅へ戻す
const WIDE_VIEWPORT = { width: 1280, height: 800 } as const;
const DEFAULT_VIEWPORT = { width: 414, height: 896 } as const;

afterEach(async () => {
  applyColorScheme('light');
  await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
});

describe('存在しないページの画面', () => {
  test('存在しない経路では、共通レイアウトの本文の中に404の見出しと説明を表示する', async () => {
    await renderUnknownPath();

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent(NOT_FOUND_TITLE);
    await expect.element(main().getByText(NOT_FOUND_DESCRIPTION)).toBeVisible();
    await expect.element(page.getByRole('banner')).toBeVisible();
    await expect.element(page.getByRole('contentinfo')).toBeVisible();
  });

  test('ログイン中は、存在しないページでもヘッダーのユーザーメニューとプロダクト登録への導線を描く', async () => {
    await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
    await renderUnknownPath(signedInViewerQuery());

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent(NOT_FOUND_TITLE);
    const banner = page.getByRole('banner');
    await expect
      .element(
        banner.getByRole('button', {
          name: `${VIEWER_NICKNAME}のユーザーメニュー`,
        }),
      )
      .toBeVisible();
    await expect
      .element(banner.getByRole('link', { name: 'ローンチする' }))
      .toHaveAttribute('href', '/my/products/new');
  });

  test('トップページとディレクトリへの導線を、この順に本文の中のリンクとして表示する', async () => {
    await renderUnknownPath();

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toBeVisible();
    const links = main().getByRole('link').elements();
    expect(
      links.map((link) => [link.textContent, link.getAttribute('href')]),
    ).toStrictEqual(NOT_FOUND_LINKS.map(([name, href]) => [name, href]));
  });

  test('導線のリンクにはTabで本文の見出しの後から順に移れる', async () => {
    await renderUnknownPath();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toBeVisible();
    focusMainContent();

    for (const [name] of NOT_FOUND_LINKS) {
      await userEvent.tab();
      await expect
        .element(main().getByRole('link', { name, exact: true }))
        .toHaveFocus();
    }
  });

  test('経路がnotFoundを投げた時も、同じ404の画面を共通レイアウトの中に表示する', async () => {
    await renderPageRouter({
      path: '/system/status',
      createRoutes: (rootRoute) => [
        createRoute({
          getParentRoute: () => rootRoute,
          path: '/system/status',
          beforeLoad: () => {
            throw notFound();
          },
          component: () => <h1>疎通確認</h1>,
        }),
      ],
    });

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent(NOT_FOUND_TITLE);
    await expect.element(page.getByRole('banner')).toBeVisible();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、レイアウトを含む画面全体に検査の補助の違反が無い',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderUnknownPath();
      await expect
        .element(main().getByRole('heading', { level: 1 }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
