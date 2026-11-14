import { redirect } from '@tanstack/react-router';

import type { AdminViewer } from '../../graphql/admin-viewer.ts';

export interface RequireAdminViewerInput {
  readonly context: { readonly viewer: AdminViewer | null };
  readonly location: { readonly pathname: string; readonly searchStr: string };
}

export interface AuthenticatedContext {
  readonly viewer: AdminViewer;
}

// ログイン必須の経路の無いレイアウトのbeforeLoad。管理者はルートのbeforeLoadが取得して文脈に入れているため、ここでは取得せずに判定だけを行う
export function requireAdminViewer({
  context,
  location,
}: RequireAdminViewerInput): AuthenticatedContext {
  if (context.viewer === null) {
    throw redirect({
      to: '/auth/login',
      search: { redirect: `${location.pathname}${location.searchStr}` },
    });
  }
  return { viewer: context.viewer };
}
