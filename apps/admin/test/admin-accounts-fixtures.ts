import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';

import type { GraphQLResult } from '../lib/utilities/graphql/graphql-result.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import {
  AdminAccountsDocument,
  type AdminAccountsQuery,
  type AdminRole,
  AdminViewerDocument,
} from '../src/graphql/generated/graphql.ts';
import { loadAdminAccounts } from '../src/graphql/admin-accounts.ts';
import { Route as AccountsRoute } from '../src/routes/_authenticated/accounts/index.tsx';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import {
  ADMIN_NICKNAME,
  adminViewerResult,
  adminWithRole,
} from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export type AdminAccountFields = AdminAccountsQuery['adminAccounts'][number];

export const ACCOUNTS_PATH = '/accounts';

export const SELF_ID = '01JC0ADMIN000000000000000000';

export const AVATAR_OBJECT_KEY = 'fedcba9876543210'.repeat(2);

export const AVATAR = Object.freeze({
  id: '01JC0AVATAR00000000000000000',
  objectKey: AVATAR_OBJECT_KEY,
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
} as const);

export const MODERATOR_ACCOUNT: AdminAccountFields = Object.freeze({
  id: '01JC0ADMIN000000000000000001',
  email: 'moderator@admin.example',
  nickname: '審査の担当',
  title: 'モデレーション担当',
  avatar: AVATAR,
  role: 'MODERATOR',
  status: 'ACTIVE',
  createdAt: '2026-10-01T03:00:00.000Z',
});

export const SUPER_ADMIN_ACCOUNT: AdminAccountFields = Object.freeze({
  id: '01JC0ADMIN000000000000000002',
  email: 'chief@admin.example',
  nickname: '統括の担当',
  title: null,
  avatar: null,
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
  createdAt: '2026-09-01T03:00:00.000Z',
});

export const INVITED_ACCOUNT: AdminAccountFields = Object.freeze({
  id: '01JC0ADMIN000000000000000003',
  email: 'invited@admin.example',
  nickname: null,
  title: null,
  avatar: null,
  role: 'VIEWER',
  status: 'INVITED',
  createdAt: '2026-11-03T03:00:00.000Z',
});

export const EXPIRED_ACCOUNT: AdminAccountFields = Object.freeze({
  id: '01JC0ADMIN000000000000000004',
  email: 'expired@admin.example',
  nickname: null,
  title: null,
  avatar: null,
  role: 'VIEWER',
  status: 'INVITATION_EXPIRED',
  createdAt: '2026-10-20T03:00:00.000Z',
});

export const selfAccountOf = (role: AdminRole): AdminAccountFields => ({
  id: SELF_ID,
  email: 'operator@admin.example',
  nickname: ADMIN_NICKNAME,
  title: 'サポート担当',
  avatar: null,
  role,
  status: 'ACTIVE',
  createdAt: '2026-08-01T03:00:00.000Z',
});

export const accountsQueryOf = (role: AdminRole): AdminAccountsQuery => ({
  adminAccounts: [
    INVITED_ACCOUNT,
    EXPIRED_ACCOUNT,
    MODERATOR_ACCOUNT,
    SUPER_ADMIN_ACCOUNT,
    selfAccountOf(role),
  ],
});

export const success = <T>(data: T): Promise<GraphQLResult<T>> =>
  Promise.resolve({ ok: true, data });

export const failure = (
  init: ConstructorParameters<typeof GraphQLClientError>[0],
): Promise<GraphQLResult<never>> =>
  Promise.resolve({ ok: false, error: new GraphQLClientError(init) });

export type GraphQLHandler = (variables: unknown) => Promise<unknown>;

// 一覧とログイン中の管理者の取得に既定の応答を返し、変更の操作はテストが渡した応答にする
export function respondAdminGraphQL(
  executeGraphQL: Mock,
  {
    role,
    accounts = accountsQueryOf(role),
    handlers = new Map(),
  }: {
    readonly role: AdminRole;
    readonly accounts?: AdminAccountsQuery;
    readonly handlers?: ReadonlyMap<unknown, GraphQLHandler>;
  },
): void {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    const handler = handlers.get(document);
    if (handler !== undefined) {
      return handler(variables);
    }
    if (document === AdminAccountsDocument) {
      return success(accounts);
    }
    if (document === AdminViewerDocument) {
      return Promise.resolve(adminViewerResult(adminWithRole(role)));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す。経路の設定のloaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)
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
        path: ACCOUNTS_PATH,
        loader: loadAdminAccounts,
        component: AccountsRoute.options.component,
      }),
    ]),
  ];
};

export const renderAccountsPage = (role: AdminRole) =>
  renderPageRouter({
    path: ACCOUNTS_PATH,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });

export const callsOf = (executeGraphQL: Mock, document: unknown) =>
  executeGraphQL.mock.calls.filter(([called]) => called === document);
