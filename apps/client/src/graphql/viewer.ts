import type { QueryClient } from '@tanstack/react-query';

import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  type AccountStatus,
  ClientViewerDocument,
  type ClientViewerQuery,
} from './generated/graphql.ts';

export interface ClientViewer {
  readonly id: string;
  readonly handle: string;
  readonly nickname: string;
  readonly emailVerified: boolean;
  readonly status: AccountStatus;
  readonly totpEnabled: boolean;
}

export interface RootAuthContext {
  readonly viewer: ClientViewer | null;
}

export const viewerQueryOptions = () =>
  graphqlQueryOptions(ClientViewerDocument, {});

export type ViewerQueryOptions = ReturnType<typeof viewerQueryOptions>;

export const toClientViewer = ({
  viewer,
}: ClientViewerQuery): ClientViewer | null =>
  viewer === null
    ? null
    : {
        id: viewer.id,
        handle: viewer.handle,
        nickname: viewer.nickname,
        emailVerified: viewer.emailVerified,
        status: viewer.status,
        totpEnabled: viewer.totpEnabled,
      };

// 取得の失敗で閲覧を止めないよう、失敗は未ログインとして扱う。想定外のGraphQLの失敗はexecuteGraphQLがエラートラッキングへ送っている
export async function loadRootAuthContext({
  context,
}: {
  readonly context: { readonly queryClient: QueryClient };
}): Promise<RootAuthContext> {
  try {
    return {
      viewer: await context.queryClient.query({
        ...viewerQueryOptions(),
        select: toClientViewer,
      }),
    };
  } catch {
    return { viewer: null };
  }
}
