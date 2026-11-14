import { createRoute } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import { hasRole } from '../common-lib/admin/admin-roles.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { toLoginSearch } from '../lib/utilities/auth/return-path.ts';
import { AuthenticatedLayout } from '../src/components/auth/authenticated-layout.tsx';
import { redirectSignedInAdmin } from '../src/components/auth/redirect-signed-in-admin.ts';
import { requireAdminViewer } from '../src/components/auth/require-admin-viewer.ts';
import { RoleGate } from '../src/components/layout/role-gate.tsx';
import {
  useAdminRole,
  useCurrentAdmin,
} from '../src/components/layout/use-current-admin.ts';
import {
  AdminViewerDocument,
  type AdminRole,
} from '../src/graphql/generated/graphql.ts';
import {
  ADMIN_NICKNAME,
  adminViewerResult,
  adminWithRole,
  signedInAdminQuery,
} from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const UNAVAILABLE = new GraphQLClientError({
  code: 'upstream_unavailable',
  message: '現在ご利用いただけません。時間をおいて再度お試しください。',
  status: 503,
});

const ACCOUNTS_PATH = '/accounts';
const LOGIN_PATH = '/auth/login';
const DASHBOARD_TITLE = 'ダッシュボード';
const LOGIN_TITLE = 'ログイン';
const INVITE_BUTTON = '管理者を招待';
const CHANGE_ROLE_BUTTON = 'ロールを変更';
const NO_PERMISSION_NOTE = '招待はモデレーター以上が行えます。';

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });

// 後続の画面と同じく、ログイン中の管理者とロールを文脈から読み、招待はモデレーター以上だけに描き、ロールの変更は最上位管理者以外では無効にする
function AccountsPage() {
  const admin = useCurrentAdmin();
  const role = useAdminRole();
  return (
    <>
      <h1>{admin.nickname}の管理者アカウント</h1>
      <RoleGate minimum="moderator" fallback={<p>{NO_PERMISSION_NOTE}</p>}>
        <button type="button">{INVITE_BUTTON}</button>
      </RoleGate>
      <button type="button" disabled={!hasRole(role, 'super_admin')}>
        {CHANGE_ROLE_BUTTON}
      </button>
    </>
  );
}

// アプリの経路と同じく、ログイン必須の経路の無いレイアウトの下に管理画面のページを、その外にログイン画面を置く
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: requireAdminViewer,
    component: AuthenticatedLayout,
  });
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: LOGIN_PATH,
      validateSearch: toLoginSearch,
      beforeLoad: redirectSignedInAdmin,
      component: () => <h1>{LOGIN_TITLE}</h1>,
    }),
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/',
        component: () => <h1>{DASHBOARD_TITLE}</h1>,
      }),
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: ACCOUNTS_PATH,
        component: AccountsPage,
      }),
    ]),
  ];
};

const renderAccountsAs = (role: AdminRole) =>
  renderPageRouter({
    path: ACCOUNTS_PATH,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });

beforeEach(() => {
  executeGraphQL.mockReset();
});

describe('ログイン必須の領域', () => {
  test('未ログインで管理者アカウントのページを開くと、パスを戻り先にしたログイン画面へ移す', async () => {
    const router = await renderPageRouter({
      path: ACCOUNTS_PATH,
      createRoutes,
    });

    await expect.element(pageTitle()).toHaveTextContent(LOGIN_TITLE);
    expect(router.state.location.pathname).toBe(LOGIN_PATH);
    expect(router.state.location.search).toEqual({ redirect: ACCOUNTS_PATH });
  });

  test('戻り先にはパスとクエリの両方を含める', async () => {
    const router = await renderPageRouter({
      path: `${ACCOUNTS_PATH}?status=invited`,
      createRoutes,
    });

    await expect.element(pageTitle()).toHaveTextContent(LOGIN_TITLE);
    expect(router.state.location.search).toEqual({
      redirect: `${ACCOUNTS_PATH}?status=invited`,
    });
  });

  test('ログイン中は、ページを文脈の管理者で描き、取得し直さない', async () => {
    await renderPageRouter({
      path: ACCOUNTS_PATH,
      createRoutes,
      cachedViewer: signedInAdminQuery(),
    });

    await expect
      .element(pageTitle())
      .toHaveTextContent(`${ADMIN_NICKNAME}の管理者アカウント`);
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('キャッシュが無ければ、ルートのbeforeLoadでログイン中の管理者を取得して文脈に入れる', async () => {
    executeGraphQL.mockResolvedValue(adminViewerResult(signedInAdminQuery()));

    await renderPageRouter({
      path: ACCOUNTS_PATH,
      createRoutes,
      cachedViewer: null,
    });

    await expect
      .element(pageTitle())
      .toHaveTextContent(`${ADMIN_NICKNAME}の管理者アカウント`);
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      AdminViewerDocument,
      {},
      expect.anything(),
    );
  });

  test('取得に失敗したら未ログインとして扱い、ログイン画面へ移す', async () => {
    executeGraphQL.mockResolvedValue({ ok: false, error: UNAVAILABLE });

    const router = await renderPageRouter({
      path: ACCOUNTS_PATH,
      createRoutes,
      cachedViewer: null,
    });

    await expect.element(pageTitle()).toHaveTextContent(LOGIN_TITLE);
    expect(router.state.location.search).toEqual({ redirect: ACCOUNTS_PATH });
  });
});

describe('ログイン画面', () => {
  test('ログイン中に開くと、ダッシュボードへ移す', async () => {
    const router = await renderPageRouter({
      path: `${LOGIN_PATH}?redirect=${encodeURIComponent(ACCOUNTS_PATH)}`,
      createRoutes,
      cachedViewer: signedInAdminQuery(),
    });

    await expect.element(pageTitle()).toHaveTextContent(DASHBOARD_TITLE);
    expect(router.state.location.pathname).toBe('/');
  });

  test('未ログインで開くと、ログイン画面をそのまま描く', async () => {
    const router = await renderPageRouter({ path: LOGIN_PATH, createRoutes });

    await expect.element(pageTitle()).toHaveTextContent(LOGIN_TITLE);
    expect(router.state.location.pathname).toBe(LOGIN_PATH);
  });
});

describe('ロールによる表示の出し分け', () => {
  test('閲覧のみでは、モデレーター以上の操作を描かずに代わりの案内を描き、最上位管理者の操作を無効にする', async () => {
    await renderAccountsAs('VIEWER');

    await expect.element(main().getByText(NO_PERMISSION_NOTE)).toBeVisible();
    await expect
      .element(main().getByRole('button', { name: INVITE_BUTTON }))
      .not.toBeInTheDocument();
    await expect
      .element(main().getByRole('button', { name: CHANGE_ROLE_BUTTON }))
      .toHaveAttribute('disabled');
  });

  test('モデレーターでは、モデレーター以上の操作を描き、最上位管理者の操作を無効にする', async () => {
    await renderAccountsAs('MODERATOR');

    await expect
      .element(main().getByRole('button', { name: INVITE_BUTTON }))
      .toBeEnabled();
    await expect
      .element(main().getByText(NO_PERMISSION_NOTE))
      .not.toBeInTheDocument();
    await expect
      .element(main().getByRole('button', { name: CHANGE_ROLE_BUTTON }))
      .toHaveAttribute('disabled');
  });

  test('最上位管理者では、すべての操作を描いて有効にする', async () => {
    await renderAccountsAs('SUPER_ADMIN');

    await expect
      .element(main().getByRole('button', { name: INVITE_BUTTON }))
      .toBeEnabled();
    await expect
      .element(main().getByRole('button', { name: CHANGE_ROLE_BUTTON }))
      .not.toHaveAttribute('disabled');
  });
});

describe('ログイン必須の領域の外での誤用', () => {
  const ERROR_TITLE = 'ページを表示できませんでした。';

  test('ログインの判定を通らない経路でレイアウトの部品を使うと、エラーの画面を描く', async () => {
    await renderPageRouter({
      path: ACCOUNTS_PATH,
      createRoutes: (rootRoute) => {
        const layoutRoute = createRoute({
          getParentRoute: () => rootRoute,
          id: '_authenticated',
          component: AuthenticatedLayout,
        });
        return [
          layoutRoute.addChildren([
            createRoute({
              getParentRoute: () => layoutRoute,
              path: ACCOUNTS_PATH,
              component: AccountsPage,
            }),
          ]),
        ];
      },
    });

    await expect.element(pageTitle()).toHaveTextContent(ERROR_TITLE);
  });

  test('ログイン必須の領域の外でロールを読むと、エラーの画面を描く', async () => {
    await renderPageRouter({
      path: ACCOUNTS_PATH,
      createRoutes: (rootRoute) => [
        createRoute({
          getParentRoute: () => rootRoute,
          path: ACCOUNTS_PATH,
          component: AccountsPage,
        }),
      ],
      cachedViewer: signedInAdminQuery(),
    });

    await expect.element(pageTitle()).toHaveTextContent(ERROR_TITLE);
  });
});
