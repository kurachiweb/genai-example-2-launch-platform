import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';
import { render } from 'vitest-browser-react';

import { Toaster } from '../lib/components/feedback/toaster.tsx';

import { userModerationListArgsOf } from '../src/components/moderation/shared/moderation-search.ts';
import { loadAdminModerationUsersPage } from '../src/graphql/admin-moderation-users.ts';
import {
  type AdminRole,
  AdminSuspendUserDocument,
  type AdminSuspendUserMutationVariables,
  AdminUnsuspendUserDocument,
  AdminUsersDocument,
  type AdminUsersQuery,
  type AdminUsersQueryVariables,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as UsersRoute } from '../src/routes/_authenticated/users/index.tsx';
import { success } from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import {
  ACTIVE_USER_NODE,
  MODERATION_REASON,
  type ModerationGraphQLHandler,
  relayPathOf,
  respondModerationGraphQL,
} from './moderation-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const USERS_PATH = '/users';

export type UserNode = AdminUsersQuery['adminUsers']['nodes'][number];

const PUBLIC_AVATAR_FILE_ID = '01KA0MED1A0000000000000011';

const QUARANTINED_AVATAR_FILE_ID = '01KA0MED1A0000000000000012';

export const PUBLIC_AVATAR_USER_NODE: UserNode = Object.freeze<UserNode>({
  id: '01KA0VSER00000000000000002',
  handle: 'pixel_hanako',
  nickname: 'サンプル花子',
  avatar: {
    id: PUBLIC_AVATAR_FILE_ID,
    path: relayPathOf(PUBLIC_AVATAR_FILE_ID),
    quarantined: false,
    quarantineReasons: [],
  },
  registeredAt: '2026-10-02T03:30:00.000Z',
  disposableEmail: 'DISPOSABLE',
  status: 'ACTIVE',
  suspendedAt: null,
  latestSuspension: null,
});

export const SUSPENDED_USER_NODE: UserNode = Object.freeze<UserNode>({
  id: '01KA0VSER00000000000000003',
  handle: 'spam_jiro',
  nickname: 'サンプル次郎',
  avatar: {
    id: QUARANTINED_AVATAR_FILE_ID,
    path: relayPathOf(QUARANTINED_AVATAR_FILE_ID),
    quarantined: true,
    quarantineReasons: ['USER_SUSPENDED'],
  },
  registeredAt: '2026-09-15T00:00:00.000Z',
  disposableEmail: 'UNVERIFIED',
  status: 'SUSPENDED',
  suspendedAt: '2026-11-12T03:00:00.000Z',
  latestSuspension: {
    reason: MODERATION_REASON,
    occurredAt: '2026-11-12T03:00:00.000Z',
  },
});

// 措置の記録が保持期間を過ぎて削除された停止中の利用者
export const UNRECORDED_SUSPENDED_USER_NODE: UserNode = Object.freeze<UserNode>(
  {
    id: '01KA0VSER00000000000000004',
    handle: 'old_saburo',
    nickname: 'サンプル三郎',
    avatar: null,
    registeredAt: '2023-04-01T00:00:00.000Z',
    disposableEmail: 'UNDETERMINED',
    status: 'SUSPENDED',
    suspendedAt: '2023-05-01T00:00:00.000Z',
    latestSuspension: null,
  },
);

export const USER_NODES: readonly UserNode[] = Object.freeze([
  ACTIVE_USER_NODE,
  PUBLIC_AVATAR_USER_NODE,
  SUSPENDED_USER_NODE,
  UNRECORDED_SUSPENDED_USER_NODE,
]);

export const usersQueryOf = (
  nodes: readonly UserNode[],
  endCursor: string | null = null,
): AdminUsersQuery => ({
  adminUsers: {
    nodes: [...nodes],
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

export type UsersHandler = (
  variables: AdminUsersQueryVariables,
) => Promise<unknown>;

// ログイン中の管理者と、ユーザーの一覧・停止・停止解除の操作にテストが渡した応答を返す
export function respondUsersGraphQL(
  executeGraphQL: Mock,
  {
    role,
    users = () => success(usersQueryOf(USER_NODES)),
    handlers = new Map(),
  }: {
    readonly role: AdminRole;
    readonly users?: UsersHandler;
    readonly handlers?: ReadonlyMap<unknown, ModerationGraphQLHandler>;
  },
): void {
  respondModerationGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, ModerationGraphQLHandler>([
      [
        AdminUsersDocument,
        (variables) => users(variables as AdminUsersQueryVariables),
      ],
      ...handlers,
    ]),
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置(同じ経路のID)の経路へ写す。検索パラメータの検証・loaderの依存・loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const usersRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'users',
  });
  return [
    authenticatedRoute.addChildren([
      usersRoute.addChildren([
        createRoute({
          getParentRoute: () => usersRoute,
          path: '/',
          validateSearch: UsersRoute.options.validateSearch,
          loaderDeps: ({ search }) => userModerationListArgsOf(search),
          loader: loadAdminModerationUsersPage,
          component: UsersRoute.options.component,
        }),
      ]),
    ]),
  ];
};

// 措置の結果のトーストは文書の外枠が置くため、ページのルーターの外に置く
export async function renderUsersPage(role: AdminRole, path = USERS_PATH) {
  await render(<Toaster />);
  return renderPageRouter({
    path,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });
}

export const usersVariablesOf = (
  executeGraphQL: Mock,
): readonly AdminUsersQueryVariables[] =>
  executeGraphQL.mock.calls
    .filter(([document]) => document === AdminUsersDocument)
    .map(([, variables]) => variables as AdminUsersQueryVariables);

export const userTransitionVariablesOf = (
  executeGraphQL: Mock,
  document: typeof AdminSuspendUserDocument | typeof AdminUnsuspendUserDocument,
): readonly AdminSuspendUserMutationVariables[] =>
  executeGraphQL.mock.calls
    .filter(([called]) => called === document)
    .map(([, variables]) => variables as AdminSuspendUserMutationVariables);
