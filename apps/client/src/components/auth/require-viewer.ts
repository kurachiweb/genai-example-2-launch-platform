import { redirect } from '@tanstack/react-router';

import type { ClientViewer } from '../../graphql/viewer.ts';

export interface RequireViewerInput {
  readonly context: { readonly viewer: ClientViewer | null };
  readonly location: { readonly pathname: string; readonly searchStr: string };
}

export interface AuthenticatedContext {
  readonly viewer: ClientViewer;
}

// ログイン必須の経路の無いレイアウトのbeforeLoad。利用者はルートのbeforeLoadが取得して文脈に入れているため、ここでは取得せずに判定だけを行う
export function requireViewer({
  context,
  location,
}: RequireViewerInput): AuthenticatedContext {
  if (context.viewer === null) {
    throw redirect({
      to: '/auth/login',
      search: { redirect: `${location.pathname}${location.searchStr}` },
    });
  }
  return { viewer: context.viewer };
}
