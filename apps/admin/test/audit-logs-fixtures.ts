import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';

import { toAuditLogSearch } from '../src/components/audit/audit-log-search.ts';
import { loadAuditLogsPage } from '../src/components/audit/load-audit-logs-page.ts';
import type { AuditLogEntry } from '../src/graphql/admin-audit-logs.ts';
import {
  AdminAuditLogsDocument,
  type AdminAuditLogsQuery,
  type AdminAuditLogsQueryVariables,
  type AdminRole,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuditLogsRoute } from '../src/routes/_authenticated/audit-logs/index.tsx';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import {
  INVITED_ACCOUNT,
  MODERATOR_ACCOUNT,
  respondAdminGraphQL,
  SUPER_ADMIN_ACCOUNT,
  success,
} from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const AUDIT_LOGS_PATH = '/audit-logs';

export const DELETED_OPERATOR_ID = '01JC0ADMIN0000000000000000DD';

export const PSEUDONYMOUS_USER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

export const INVITE_ENTRY: AuditLogEntry = Object.freeze({
  id: '01JC0AUDIT000000000000000003',
  occurredAt: '2026-11-03T01:30:00.000Z',
  operator: { id: MODERATOR_ACCOUNT.id, nickname: MODERATOR_ACCOUNT.nickname },
  action: 'admin-account.invite',
  actionLabel: '管理者の招待',
  targetKind: 'admin',
  targetIds: [INVITED_ACCOUNT.id],
  reason: '審査の担当者を増やすため',
  detail: [],
});

export const ROLE_CHANGE_ENTRY: AuditLogEntry = Object.freeze({
  id: '01JC0AUDIT000000000000000002',
  occurredAt: '2026-11-02T08:00:00.000Z',
  operator: { id: DELETED_OPERATOR_ID, nickname: null },
  action: 'admin-account.role-change',
  actionLabel: '管理者のロールの変更',
  targetKind: 'admin',
  targetIds: [MODERATOR_ACCOUNT.id],
  reason: null,
  detail: [
    { key: 'fromRole', value: 'viewer' },
    { key: 'toRole', value: 'moderator' },
  ],
});

export const EMAIL_SEARCH_ENTRY: AuditLogEntry = Object.freeze({
  id: '01JC0AUDIT000000000000000001',
  occurredAt: '2026-11-01T00:15:00.000Z',
  operator: {
    id: SUPER_ADMIN_ACCOUNT.id,
    nickname: SUPER_ADMIN_ACCOUNT.nickname,
  },
  action: 'user.email-search',
  actionLabel: 'ユーザーのメールアドレス検索',
  targetKind: null,
  targetIds: [],
  reason: null,
  detail: [],
});

export const auditLogsQueryOf = (
  entries: readonly AuditLogEntry[],
  nextCursor: string | null = null,
): AdminAuditLogsQuery => ({
  auditLogs: { entries: [...entries], nextCursor },
});

export const FIRST_PAGE = auditLogsQueryOf(
  [INVITE_ENTRY, ROLE_CHANGE_ENTRY, EMAIL_SEARCH_ENTRY],
  null,
);

export type AuditLogsHandler = (
  variables: AdminAuditLogsQueryVariables,
) => Promise<unknown>;

// 一覧と操作者の選択肢とログイン中の管理者の取得に応答し、監査ログの検索はテストが渡した応答にする
export function respondAuditLogsGraphQL(
  executeGraphQL: Mock,
  {
    role,
    auditLogs = () => success(FIRST_PAGE),
  }: {
    readonly role: AdminRole;
    readonly auditLogs?: AuditLogsHandler;
  },
): void {
  respondAdminGraphQL(executeGraphQL, {
    role,
    handlers: new Map([
      [
        AdminAuditLogsDocument,
        (variables: unknown) =>
          auditLogs(variables as AdminAuditLogsQueryVariables),
      ],
    ]),
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置(同じ経路のID)の経路へ写す。経路の設定の検索パラメータの検証・loaderの依存・loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const auditLogsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'audit-logs',
  });
  return [
    authenticatedRoute.addChildren([
      auditLogsRoute.addChildren([
        createRoute({
          getParentRoute: () => auditLogsRoute,
          path: '/',
          validateSearch: toAuditLogSearch,
          loaderDeps: ({ search }) => search,
          loader: loadAuditLogsPage,
          component: AuditLogsRoute.options.component,
        }),
      ]),
    ]),
  ];
};

export const renderAuditLogsPage = (role: AdminRole, path = AUDIT_LOGS_PATH) =>
  renderPageRouter({
    path,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });

export const auditLogsVariablesOf = (
  executeGraphQL: Mock,
): readonly AdminAuditLogsQueryVariables[] =>
  executeGraphQL.mock.calls
    .filter(([document]) => document === AdminAuditLogsDocument)
    .map(([, variables]) => variables as AdminAuditLogsQueryVariables);
