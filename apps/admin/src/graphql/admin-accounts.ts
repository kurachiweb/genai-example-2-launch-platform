import type { QueryClient } from '@tanstack/react-query';

import type { AdminRole } from '../../common-lib/admin/admin-roles.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import type { MediaImageView } from '../../lib/utilities/media/picture-sources.ts';
import { fromGraphQLAdminRole } from './admin-role.ts';
import {
  type AdminAccountStatus as GraphQLAdminAccountStatus,
  AdminAccountsDocument,
  type AdminAccountsQuery,
} from './generated/graphql.ts';

export type AdminAccountStatus = 'active' | 'invited' | 'invitation_expired';

export interface AdminAccountAvatar extends MediaImageView {
  // プロフィールの編集で画像を保つときに送り返す識別子
  readonly id: string;
}

export interface AdminAccount {
  readonly id: string;
  readonly email: string;
  // 招待の完了前はnull
  readonly nickname: string | null;
  readonly title: string | null;
  readonly avatar: AdminAccountAvatar | null;
  readonly role: AdminRole;
  readonly status: AdminAccountStatus;
  readonly createdAt: string;
}

type AdminAccountFields = AdminAccountsQuery['adminAccounts'][number];

const FROM_GRAPHQL_STATUS: Readonly<
  Record<GraphQLAdminAccountStatus, AdminAccountStatus>
> = Object.freeze({
  ACTIVE: 'active',
  INVITED: 'invited',
  INVITATION_EXPIRED: 'invitation_expired',
});

export const adminAccountsQueryOptions = () =>
  graphqlQueryOptions(AdminAccountsDocument, {});

export const toAdminAccount = (account: AdminAccountFields): AdminAccount => ({
  id: account.id,
  email: account.email,
  nickname: account.nickname,
  title: account.title,
  avatar: account.avatar === null ? null : { ...account.avatar },
  role: fromGraphQLAdminRole(account.role),
  status: FROM_GRAPHQL_STATUS[account.status],
  createdAt: account.createdAt,
});

export const toAdminAccounts = ({
  adminAccounts,
}: AdminAccountsQuery): readonly AdminAccount[] =>
  adminAccounts.map(toAdminAccount);

// 一覧が無ければページを表示できないため、取得の失敗はそのまま投げてルートのエラーの画面に任せる
export async function loadAdminAccounts({
  context,
}: {
  readonly context: { readonly queryClient: QueryClient };
}): Promise<void> {
  await context.queryClient.query(adminAccountsQueryOptions());
}
