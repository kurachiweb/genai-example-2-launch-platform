import { createRoute, notFound } from '@tanstack/react-router';
import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  focusMainContent,
  renderPageRouter,
} from '../../../test/page-router.tsx';

const NOT_FOUND_TITLE = 'ページが見つかりません。';
const NOT_FOUND_DESCRIPTION =
  'お探しのページは見つかりませんでした。URLをご確認ください。';

const NOT_FOUND_LINKS = [
  ['トップページへ', '/'],
  ['ディレクトリを見る', '/p'],
] as const;

const main = () => page.getByRole('main');

const renderUnknownPath = () =>
  renderPageRouter({
    path: '/no-such-page',
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/',
        component: () => <h1>トップページ</h1>,
      }),
    ],
  });

afterEach(() => {
  applyColorScheme('light');
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
