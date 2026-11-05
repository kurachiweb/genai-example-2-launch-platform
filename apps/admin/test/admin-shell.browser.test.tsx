import { createRoute } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as DashboardRoute } from '../src/routes/_authenticated/index.tsx';
import { Route as LoginRoute } from '../src/routes/auth/login.tsx';
import {
  AdminLogoutDocument,
  AdminViewerDocument,
} from '../src/graphql/generated/graphql.ts';
import { buildAdminPageHead } from '../src/head/page-heads.ts';
import {
  ADMIN_NICKNAME,
  adminViewerResult,
  GUEST_ADMIN_QUERY,
  signedInAdminQuery,
} from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

// ログイン中の管理者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

const LOGIN_PATH = '/auth/login';
const LOGIN_TITLE = 'ログイン';
const NOT_FOUND_TITLE = 'ページが見つかりません。';
const NAVIGATION_NAME = '管理メニュー';
const MENU_ITEMS = [
  'ダッシュボード',
  'カテゴリ',
  '法務文書',
  '管理者アカウント',
  '監査ログ',
  '自分のアカウント',
];

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const navigation = () =>
  page.getByRole('navigation', { name: NAVIGATION_NAME });
const accountButton = () => page.getByRole('button', { name: ADMIN_NICKNAME });

// アプリの経路と同じログイン必須のレイアウトとダッシュボードとログイン画面の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: LOGIN_PATH,
      validateSearch: LoginRoute.options.validateSearch,
      beforeLoad: LoginRoute.options.beforeLoad,
      component: LoginRoute.options.component,
    }),
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/',
        component: DashboardRoute.options.component,
      }),
    ]),
  ];
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await page.viewport(1280, 800);
});

describe('管理画面のシェル', () => {
  test('ログイン後のダッシュボードに、空状態と登録箇所のメニューとアカウントの表示を出す', async () => {
    await renderPageRouter({
      path: '/',
      createRoutes,
      cachedViewer: signedInAdminQuery(),
    });

    await expect.element(pageTitle()).toHaveTextContent('ダッシュボード');
    await expect
      .element(main().getByText('表示できる項目はまだありません。'))
      .toBeVisible();
    await expect.element(navigation()).toBeVisible();
    expect(
      Array.from(
        navigation().element().querySelectorAll('a'),
        (link) => link.textContent,
      ),
    ).toStrictEqual(MENU_ITEMS);
    await expect
      .element(navigation().getByRole('link', { name: 'ダッシュボード' }))
      .toHaveAttribute('aria-current', 'page');
    await expect
      .element(
        page.getByRole('banner').getByRole('button', { name: ADMIN_NICKNAME }),
      )
      .toBeVisible();
    expect(page.getByRole('contentinfo').elements()).toHaveLength(0);
  });

  test('ダッシュボードでログアウトすると、取り直した未ログインの状態でダッシュボードを戻り先にしたログイン画面へ移り、メニューとアカウントの表示を消す', async () => {
    let signedIn = true;
    executeGraphQL.mockImplementation((document: unknown) => {
      if (document === AdminViewerDocument) {
        return Promise.resolve(
          adminViewerResult(
            signedIn ? signedInAdminQuery() : GUEST_ADMIN_QUERY,
          ),
        );
      }
      if (document === AdminLogoutDocument) {
        signedIn = false;
        return Promise.resolve({ ok: true, data: { adminLogout: true } });
      }
      throw new Error('想定していない操作が実行されました。');
    });
    const router = await renderPageRouter({
      path: '/',
      createRoutes,
      cachedViewer: signedInAdminQuery(),
    });
    await expect.element(pageTitle()).toHaveTextContent('ダッシュボード');

    await userEvent.click(accountButton());
    await userEvent.click(page.getByRole('menuitem', { name: 'ログアウト' }));

    await expect.element(pageTitle()).toHaveTextContent(LOGIN_TITLE);
    expect(router.state.location.pathname).toBe(LOGIN_PATH);
    expect(router.state.location.search).toEqual({ redirect: '/' });
    expect(page.getByRole('navigation').elements()).toHaveLength(0);
    await expect.element(accountButton()).not.toBeInTheDocument();
  });

  test('未ログインでダッシュボードを開くとログイン画面へ移り、メニューとアカウントの表示を出さない', async () => {
    const router = await renderPageRouter({ path: '/', createRoutes });

    await expect.element(pageTitle()).toHaveTextContent(LOGIN_TITLE);
    expect(router.state.location.pathname).toBe(LOGIN_PATH);
    expect(page.getByRole('navigation').elements()).toHaveLength(0);
    await expect.element(accountButton()).not.toBeInTheDocument();
  });

  test('未ログインの存在しないページに、メニューとアカウントの表示を出さない', async () => {
    await renderPageRouter({
      path: '/unknown',
      createRoutes,
      cachedViewer: GUEST_ADMIN_QUERY,
    });

    await expect.element(pageTitle()).toHaveTextContent(NOT_FOUND_TITLE);
    expect(page.getByRole('navigation').elements()).toHaveLength(0);
    await expect.element(accountButton()).not.toBeInTheDocument();
    await expect
      .element(
        page
          .getByRole('banner')
          .getByRole('button', { name: 'ダークモードに切り替え' }),
      )
      .toBeVisible();
    expect(
      page.getByRole('banner').getByRole('button').elements(),
    ).toHaveLength(1);
  });

  test('ログイン中の存在しないページには、メニューとアカウントの表示を出す', async () => {
    await renderPageRouter({
      path: '/unknown',
      createRoutes,
      cachedViewer: signedInAdminQuery(),
    });

    await expect.element(pageTitle()).toHaveTextContent(NOT_FOUND_TITLE);
    await expect.element(navigation()).toBeVisible();
    await expect.element(accountButton()).toBeVisible();
  });

  test('ログイン後のダッシュボードで、アクセシビリティの検査の違反が0件', async () => {
    await renderPageRouter({
      path: '/',
      createRoutes,
      cachedViewer: signedInAdminQuery(),
    });
    await expect.element(pageTitle()).toHaveTextContent('ダッシュボード');

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('ダッシュボードのページの題名をダッシュボードにする', () => {
    expect(DashboardRoute.options.head?.({} as never)).toStrictEqual(
      buildAdminPageHead({ title: 'ダッシュボード' }),
    );
  });
});
