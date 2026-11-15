import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { PathLink } from './path-link.tsx';

const HOME_PATH = '/';
const ACCOUNTS_PATH = '/accounts';
const ACCOUNT_DETAIL_PATH = '/accounts/detail';
const ACCOUNT_PATH = '/account';

// 型で指定できない経路の代わりに、パスの文字列だけでリンクを並べる
function Links() {
  return (
    <nav aria-label="テストのメニュー" className="flex gap-4">
      <PathLink href={HOME_PATH} activeOptions={{ exact: true }}>
        トップ
      </PathLink>
      <PathLink href={ACCOUNTS_PATH}>一覧</PathLink>
      <PathLink href={ACCOUNT_PATH}>自分</PathLink>
    </nav>
  );
}

function renderLinks(path: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <div className="bg-background p-4 text-foreground">
        <Links />
        <main>
          <Outlet />
        </main>
      </div>
    ),
  });
  const pageRoute = (routePath: string, title: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      component: () => <h1>{title}</h1>,
    });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      pageRoute(HOME_PATH, 'トップの画面'),
      pageRoute(ACCOUNTS_PATH, '一覧の画面'),
      pageRoute(ACCOUNT_DETAIL_PATH, '詳細の画面'),
      pageRoute(ACCOUNT_PATH, '自分の画面'),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return { router, rendered: render(<RouterProvider router={router} />) };
}

const link = (name: string) => page.getByRole('link', { name, exact: true });

const currentLinks = () =>
  page
    .getByRole('link')
    .elements()
    .filter((element) => element.getAttribute('aria-current') === 'page')
    .map((element) => element.textContent);

describe('PathLink', () => {
  test('パスをリンクの行き先にする', async () => {
    await renderLinks(HOME_PATH).rendered;

    await expect.element(link('一覧')).toHaveAttribute('href', ACCOUNTS_PATH);
    await expect.element(link('自分')).toHaveAttribute('href', ACCOUNT_PATH);
  });

  test('選ぶと、ページを読み込み直さずにルーターでパスの画面へ遷移する', async () => {
    const { router, rendered } = renderLinks(HOME_PATH);
    await rendered;
    const marker = Symbol('同じ文書');
    Object.assign(window, { pathLinkMarker: marker });

    await userEvent.click(link('一覧'));

    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('一覧の画面');
    expect(router.state.location.pathname).toBe(ACCOUNTS_PATH);
    expect(Reflect.get(window, 'pathLinkMarker')).toBe(marker);
  });

  test('現在のパスとその下のパスでは、そのリンクをaria-current="page"で示す', async () => {
    await renderLinks(ACCOUNT_DETAIL_PATH).rendered;

    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('詳細の画面');
    expect(currentLinks()).toStrictEqual(['一覧']);
  });

  test('完全一致の指定では、下のパスで示さず、同じパスでだけ示す', async () => {
    await renderLinks(HOME_PATH).rendered;

    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('トップの画面');
    expect(currentLinks()).toStrictEqual(['トップ']);
  });

  test('アクセシビリティの検査の違反が0件', async () => {
    const { rendered } = renderLinks(ACCOUNTS_PATH);
    const { container } = await rendered;

    await expect.element(link('一覧')).toBeVisible();
    expect(await runAxe(container)).toStrictEqual([]);
  });
});
