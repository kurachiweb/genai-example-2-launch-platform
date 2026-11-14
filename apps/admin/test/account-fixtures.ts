import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';

import {
  AdminViewerDocument,
  type AdminViewerQuery,
} from '../src/graphql/generated/graphql.ts';
import { Route as AccountRoute } from '../src/routes/_authenticated/account/index.tsx';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { failure, type GraphQLHandler } from './admin-accounts-fixtures.ts';
import {
  adminViewerResult,
  signedInAdminQuery,
} from './admin-viewer-fixtures.ts';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';

export const ACCOUNT_PATH = '/account';

export const CURRENT_PASSWORD = ['console', 'gate', 'keeper'].join('-');

export const NEW_PASSWORD = ['harbor', 'lantern', 'drift'].join('-');

export const TOTP_SECRET = ['JBSWY3DP', 'EHPK3PXP'].join('');

export const TOTP_SETUP = Object.freeze({
  otpauthUri: `otpauth://totp/Launch:operator?secret=${TOTP_SECRET}&issuer=Launch`,
  secret: TOTP_SECRET,
  expiresAt: '2026-11-04T03:10:00.000Z',
});

export const RECOVERY_CODES: readonly string[] = Object.freeze(
  Array.from({ length: 10 }, (_, index) => `rc${String(index)}-wxyz-qrst`),
);

export const CURRENT_PASSWORD_INCORRECT =
  '現在のパスワードが正しくありません。';

export const SECOND_FACTOR_INCORRECT = '認証コードが正しくありません。';

export const reauthenticationFailed = (field: string, message: string) =>
  failure({
    code: 'reauthentication_failed',
    message,
    status: 200,
    details: [{ field, code: 'incorrect', message }],
  });

// ログイン中の管理者の取得はテストが渡した値を毎回返し、変更の操作はテストが渡した応答にする
export function respondAccountGraphQL(
  executeGraphQL: Mock,
  {
    viewer = () => signedInAdminQuery(),
    handlers = new Map(),
  }: {
    readonly viewer?: () => AdminViewerQuery;
    readonly handlers?: ReadonlyMap<unknown, GraphQLHandler>;
  } = {},
): void {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    const handler = handlers.get(document);
    if (handler !== undefined) {
      return handler(variables);
    }
    if (document === AdminViewerDocument) {
      return Promise.resolve(adminViewerResult(viewer()));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  return [
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: ACCOUNT_PATH,
        component: AccountRoute.options.component,
      }),
    ]),
  ];
};

export async function renderAccountPage(
  cachedViewer: AdminViewerQuery = signedInAdminQuery(),
  context = createPageRouterContext('local'),
) {
  const router = await renderPageRouter({
    path: ACCOUNT_PATH,
    createRoutes,
    context,
    cachedViewer,
  });
  return { router, context };
}
