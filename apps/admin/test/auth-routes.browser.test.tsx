import { createRoute } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { resetTurnstileScriptFailure } from '../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../lib/test/a11y.ts';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import {
  AdminCompleteSecondFactorLoginDocument,
  AdminLoginDocument,
  AdminViewerDocument,
} from '../src/graphql/generated/graphql.ts';
import { buildAdminPageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as DashboardRoute } from '../src/routes/_authenticated/index.tsx';
import { Route as LoginRoute } from '../src/routes/auth/login.tsx';
import { Route as PasswordResetConfirmRoute } from '../src/routes/auth/password-reset/confirm.tsx';
import { Route as PasswordResetRoute } from '../src/routes/auth/password-reset/index.tsx';
import {
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

const ACCOUNTS_TITLE = '管理者アカウントのテストのページ';
const EMAIL = 'operator@admin.example';
const PASSWORD = ['console', 'gate', 'keeper'].join('-');
const CHALLENGE = ['challenge', 'of', 'admin'].join('-');

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す。管理者アカウントのページは後続の作業で作るため、ログイン必須の領域に仮のページを置く
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
      path: '/auth/login',
      validateSearch: LoginRoute.options.validateSearch,
      beforeLoad: LoginRoute.options.beforeLoad,
      component: LoginRoute.options.component,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/password-reset/',
      component: PasswordResetRoute.options.component,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/password-reset/confirm',
      component: PasswordResetConfirmRoute.options.component,
    }),
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/',
        component: DashboardRoute.options.component,
      }),
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/accounts',
        component: () => <h1>{ACCOUNTS_TITLE}</h1>,
      }),
    ]),
  ];
};

// ルートのbeforeLoadの取り直しが第2要素の確定の後だけログイン中の管理者を返すよう、APIサーバーのセッションを写す
function respondWithSession(): void {
  let signedIn = false;
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === AdminViewerDocument) {
      return Promise.resolve(
        adminViewerResult(signedIn ? signedInAdminQuery() : GUEST_ADMIN_QUERY),
      );
    }
    if (document === AdminLoginDocument) {
      return Promise.resolve({
        ok: true,
        data: {
          adminLogin: {
            challenge: CHALLENGE,
            expiresAt: '2026-11-04T07:05:00.000Z',
          },
        },
      });
    }
    if (document === AdminCompleteSecondFactorLoginDocument) {
      signedIn = true;
      return Promise.resolve({
        ok: true,
        data: {
          completeAdminSecondFactorLogin: signedInAdminQuery().adminViewer,
        },
      });
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

async function logIn(): Promise<void> {
  await userEvent.type(
    page.getByRole('textbox', { name: 'メールアドレス' }),
    EMAIL,
  );
  await userEvent.type(
    page.getByLabelText('パスワード', { exact: true }),
    PASSWORD,
  );
  await userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));
  await userEvent.click(page.getByRole('button', { name: 'ログインする' }));
  await userEvent.type(
    page.getByRole('textbox', { name: '認証コード' }),
    '123456',
  );
  await userEvent.click(page.getByRole('button', { name: 'ログインする' }));
}

const loginPathWith = (redirect: string) =>
  `/auth/login?${new URLSearchParams({ redirect }).toString()}`;

beforeEach(async () => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
  await page.viewport(1280, 800);
});

describe('ログイン画面の経路', () => {
  test('未ログインでログイン必須のページを開くと、戻り先付きでログイン画面へ移り、メニューを出さない', async () => {
    respondWithSession();
    const router = await renderPageRouter({
      path: '/accounts?status=invited',
      createRoutes,
    });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.pathname).toBe('/auth/login');
    expect(router.state.location.search).toEqual({
      redirect: '/accounts?status=invited',
    });
    expect(page.getByRole('navigation').elements()).toHaveLength(0);
  });

  test('戻り先が同じサイト内のパスなら、ログインの後にそのページへ移ってメニューを出す', async () => {
    respondWithSession();
    const router = await renderPageRouter({
      path: loginPathWith('/accounts?status=invited'),
      createRoutes,
    });

    await logIn();

    await expect.element(pageTitle()).toHaveTextContent(ACCOUNTS_TITLE);
    expect(router.state.location.href).toBe('/accounts?status=invited');
    await expect
      .element(page.getByRole('navigation', { name: '管理メニュー' }))
      .toBeVisible();
  });

  test.each([
    ['別のサイトのURL', 'https://evil.example/accounts'],
    ['プロトコル相対のURL', '//evil.example/accounts'],
    ['バックスラッシュで別のサイトを指すパス', '/\\evil.example/accounts'],
    ['パスでない値', 'accounts'],
  ])(
    '戻り先が%sなら、ログインの後にダッシュボードへ移る',
    async (_label, redirect) => {
      respondWithSession();
      const router = await renderPageRouter({
        path: loginPathWith(redirect),
        createRoutes,
      });

      await logIn();

      await expect.element(pageTitle()).toHaveTextContent('ダッシュボード');
      expect(router.state.location.href).toBe('/');
    },
  );

  test('戻り先が無ければ、ログインの後にダッシュボードへ移る', async () => {
    respondWithSession();
    const router = await renderPageRouter({
      path: '/auth/login',
      createRoutes,
    });

    await logIn();

    await expect.element(pageTitle()).toHaveTextContent('ダッシュボード');
    expect(router.state.location.href).toBe('/');
  });

  test('ログイン中にログイン画面を開くと、ダッシュボードへ移る', async () => {
    const router = await renderPageRouter({
      path: loginPathWith('/accounts'),
      createRoutes,
      cachedViewer: signedInAdminQuery(),
    });

    await expect.element(pageTitle()).toHaveTextContent('ダッシュボード');
    expect(router.state.location.pathname).toBe('/');
  });

  test('未ログインのログイン画面で、アクセシビリティの検査の違反が0件', async () => {
    await renderPageRouter({ path: '/auth/login', createRoutes });
    await expect.element(pageTitle()).toHaveTextContent('ログイン');

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('ログイン画面のページの題名をログインにする', () => {
    expect(LoginRoute.options.head?.({} as never)).toStrictEqual(
      buildAdminPageHead({ title: 'ログイン' }),
    );
  });
});

describe('パスワードの再設定の経路', () => {
  test('再設定の要求の画面に、メールアドレスの入力欄を出し、メニューを出さない', async () => {
    await renderPageRouter({ path: '/auth/password-reset', createRoutes });

    await expect.element(pageTitle()).toHaveTextContent('パスワードの再設定');
    await expect
      .element(page.getByRole('textbox', { name: 'メールアドレス' }))
      .toBeVisible();
    expect(page.getByRole('navigation').elements()).toHaveLength(0);
  });

  test('ログイン画面から再設定の要求の画面へ移れる', async () => {
    const router = await renderPageRouter({
      path: '/auth/login',
      createRoutes,
    });

    await userEvent.click(
      page.getByRole('link', { name: 'パスワードの再設定' }),
    );

    await expect.element(pageTitle()).toHaveTextContent('パスワードの再設定');
    expect(router.state.location.pathname).toBe('/auth/password-reset');
  });

  test('新しいパスワードの設定の画面に、リンクのトークンを読んだ入力欄を出す', async () => {
    await renderPageRouter({
      path: '/auth/password-reset/confirm#token=reset-link-value',
      createRoutes,
    });

    await expect
      .element(pageTitle())
      .toHaveTextContent('新しいパスワードの設定');
    await expect
      .element(page.getByLabelText('新しいパスワード(必須)', { exact: true }))
      .toBeVisible();
  });

  test.each([
    [PasswordResetRoute, 'パスワードの再設定'],
    [PasswordResetConfirmRoute, '新しいパスワードの設定'],
  ])('ページの題名を%#の画面の題名にする', (route, title) => {
    expect(route.options.head?.({} as never)).toStrictEqual(
      buildAdminPageHead({ title }),
    );
  });
});
