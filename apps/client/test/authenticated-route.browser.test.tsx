import { createRoute, useRouteContext } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { ClientViewerDocument } from '../src/graphql/generated/graphql.ts';
import { requireViewer } from '../src/components/auth/require-viewer.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';
import {
  signedInViewerQuery,
  VIEWER_NICKNAME,
  viewerResult,
} from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const UNAVAILABLE = new GraphQLClientError({
  code: 'upstream_unavailable',
  message: '現在ご利用いただけません。時間をおいて再度お試しください。',
  status: 503,
});

const ACCOUNT_PATH = '/settings/account';
const userMenuButton = () =>
  page
    .getByRole('banner')
    .getByRole('button', { name: `${VIEWER_NICKNAME}のユーザーメニュー` });
const pageTitle = () =>
  page.getByRole('main').getByRole('heading', { level: 1 });

function AccountSettingsPage() {
  const { viewer } = useRouteContext({ strict: false });
  if (viewer === undefined || viewer === null) {
    throw new Error('ログイン必須の経路の文脈に利用者がありません。');
  }
  return <h1>{viewer.nickname}のアカウント</h1>;
}

// ログイン必須の経路の無いレイアウトと同じく、ルートの文脈の利用者で判定するbeforeLoadを持つ経路の下にページを置く
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: requireViewer,
  });
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <h1>トップページ</h1>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/login',
      component: () => <h1>ログイン</h1>,
    }),
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: ACCOUNT_PATH,
        component: AccountSettingsPage,
      }),
    ]),
  ];
};

const WIDE_VIEWPORT = { width: 1280, height: 800 } as const;

beforeEach(async () => {
  executeGraphQL.mockReset();
  await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
});

describe('ルートのbeforeLoadとログイン必須のレイアウト', () => {
  test('未ログインでログイン必須のページを開くと、パスとクエリを戻り先にしたログイン画面へ移す', async () => {
    const router = await renderPageRouter({
      path: `${ACCOUNT_PATH}?section=email`,
      createRoutes,
    });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.pathname).toBe('/auth/login');
    expect(router.state.location.search).toEqual({
      redirect: `${ACCOUNT_PATH}?section=email`,
    });
  });

  test('ログイン中は、ログイン必須のページを文脈の利用者で描き、取得し直さない', async () => {
    await renderPageRouter({
      path: ACCOUNT_PATH,
      createRoutes,
      cachedViewer: signedInViewerQuery(),
    });

    await expect
      .element(pageTitle())
      .toHaveTextContent(`${VIEWER_NICKNAME}のアカウント`);
    await expect.element(userMenuButton()).toBeVisible();
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('キャッシュが無ければ、ルートのbeforeLoadでログイン中の利用者を取得して文脈とヘッダーに使う', async () => {
    executeGraphQL.mockResolvedValue(viewerResult(signedInViewerQuery()));

    await renderPageRouter({
      path: ACCOUNT_PATH,
      createRoutes,
      cachedViewer: null,
    });

    await expect
      .element(pageTitle())
      .toHaveTextContent(`${VIEWER_NICKNAME}のアカウント`);
    await expect.element(userMenuButton()).toBeVisible();
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientViewerDocument,
      {},
      expect.anything(),
    );
  });

  test('取得に失敗したら、未ログインとしてページの描画を続ける', async () => {
    executeGraphQL.mockResolvedValue({ ok: false, error: UNAVAILABLE });

    await renderPageRouter({ path: '/', createRoutes, cachedViewer: null });

    await expect.element(pageTitle()).toHaveTextContent('トップページ');
    await expect
      .element(
        page
          .getByRole('banner')
          .getByRole('link', { name: 'ログイン', exact: true }),
      )
      .toBeInTheDocument();
  });

  test('取得に失敗した時にログイン必須のページを開くと、ログイン画面へ移す', async () => {
    executeGraphQL.mockResolvedValue({ ok: false, error: UNAVAILABLE });

    const router = await renderPageRouter({
      path: ACCOUNT_PATH,
      createRoutes,
      cachedViewer: null,
    });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({
      redirect: ACCOUNT_PATH,
    });
  });
});
