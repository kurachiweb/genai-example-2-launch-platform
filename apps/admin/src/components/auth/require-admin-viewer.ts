import { redirect } from '@tanstack/react-router';

import type { AdminViewer } from '../../graphql/admin-viewer.ts';

export interface RequireAdminViewerInput {
  readonly context: { readonly viewer: AdminViewer | null };
  readonly location: { readonly pathname: string; readonly searchStr: string };
}

export interface AuthenticatedContext {
  readonly viewer: AdminViewer;
}

const LOGIN_PATH = '/auth/login';

// ログイン必須の経路の無いレイアウトのbeforeLoad。管理者はルートのbeforeLoadが取得して文脈に入れているため、ここでは取得せずに判定だけを行う。ログイン画面の経路の有無に型を依存させないよう、行き先はhrefで渡す
export function requireAdminViewer({
  context,
  location,
}: RequireAdminViewerInput): AuthenticatedContext {
  if (context.viewer === null) {
    const search = new URLSearchParams({
      redirect: `${location.pathname}${location.searchStr}`,
    });
    throw redirect({ href: `${LOGIN_PATH}?${search.toString()}` });
  }
  return { viewer: context.viewer };
}
