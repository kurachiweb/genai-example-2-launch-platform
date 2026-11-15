import type { QueryClient } from '@tanstack/react-query';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import type { MediaImageView } from '../../lib/utilities/media/picture-sources.ts';
import { fromGraphQLAdminRole } from './admin-role.ts';
import {
  AdminViewerDocument,
  type AdminViewerQuery,
} from './generated/graphql.ts';

export interface AdminViewerAvatar extends MediaImageView {
  readonly id: string;
}

export interface AdminViewer {
  readonly id: string;
  readonly nickname: string;
  readonly title: string | null;
  readonly email: string;
  readonly role: AdminRole;
  readonly avatar: AdminViewerAvatar | null;
  readonly remainingRecoveryCodes: number;
}

export interface RootAuthContext {
  readonly viewer: AdminViewer | null;
}

export const adminViewerQueryOptions = () =>
  graphqlQueryOptions(AdminViewerDocument, {});

export const toAdminViewer = ({
  adminViewer,
}: AdminViewerQuery): AdminViewer | null =>
  adminViewer === null
    ? null
    : {
        id: adminViewer.id,
        nickname: adminViewer.nickname,
        title: adminViewer.title,
        email: adminViewer.email,
        role: fromGraphQLAdminRole(adminViewer.role),
        avatar: adminViewer.avatar === null ? null : { ...adminViewer.avatar },
        remainingRecoveryCodes: adminViewer.remainingRecoveryCodes,
      };

// 取得の失敗で画面の描画を止めないよう、失敗は未ログインとして扱う。想定外のGraphQLの失敗はexecuteGraphQLがエラートラッキングへ送っている
export async function loadRootAuthContext({
  context,
}: {
  readonly context: { readonly queryClient: QueryClient };
}): Promise<RootAuthContext> {
  try {
    return {
      viewer: await context.queryClient.query({
        ...adminViewerQueryOptions(),
        select: toAdminViewer,
      }),
    };
  } catch {
    return { viewer: null };
  }
}
