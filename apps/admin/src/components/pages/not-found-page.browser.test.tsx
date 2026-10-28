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
const HOME_LINK_NAME = 'トップページへ';

const main = () => page.getByRole('main');
const homeLink = () =>
  main().getByRole('link', { name: HOME_LINK_NAME, exact: true });

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
  test('存在しない経路では、基本レイアウトの本文の中に404の見出しと説明を表示する', async () => {
    await renderUnknownPath();

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent(NOT_FOUND_TITLE);
    await expect.element(main().getByText(NOT_FOUND_DESCRIPTION)).toBeVisible();
    await expect
      .element(
        page
          .getByRole('banner')
          .getByRole('link', { name: 'Launch Stadium管理', exact: true }),
      )
      .toBeVisible();
  });

  test('本文の中の導線はトップページへのリンクだけにする', async () => {
    await renderUnknownPath();

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toBeVisible();
    const links = main().getByRole('link').elements();
    expect(
      links.map((link) => [link.textContent, link.getAttribute('href')]),
    ).toStrictEqual([[HOME_LINK_NAME, '/']]);
  });

  test('トップページへのリンクにはTabで本文の見出しの後から移れる', async () => {
    await renderUnknownPath();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toBeVisible();
    focusMainContent();

    await userEvent.tab();
    await expect.element(homeLink()).toHaveFocus();
  });

  test('経路がnotFoundを投げた時も、同じ404の画面を基本レイアウトの中に表示する', async () => {
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
