import type { QueryClient } from '@tanstack/react-query';

import {
  ADMIN_LIST_PAGE_SIZE,
  type ModerationAction,
} from '../../common-lib/moderation/moderation-actions.ts';
import type { DisposableEmailJudgement } from '../../common-lib/moderation/moderation-labels.ts';
import type { RouterContext } from '../../lib/start/router-context.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  type AdminMediaFileView,
  type AdminModerationPage,
  type ModerationActionOptions,
  moderationActionOptions,
  type ModerationNoteView,
  toAdminMediaFile,
  toModerationNote,
  toModerationPage,
} from './admin-moderation-shared.ts';
import {
  AdminSuspendUserDocument,
  AdminUnsuspendUserDocument,
  type AdminUserFilter,
  type AdminUserStatus,
  AdminUsersDocument,
  type AdminUsersQuery,
  type AdminUsersQueryVariables,
  AdminWithdrawUserByAdministratorDocument,
  type DisposableEmailCheck,
} from './generated/graphql.ts';

export type AdminUserStatusValue = 'active' | 'suspended';

export interface AdminModerationUserFilter {
  readonly handle?: string | undefined;
  readonly nickname?: string | undefined;
  readonly email?: string | undefined;
  readonly status?: AdminUserStatusValue | undefined;
}

export interface AdminModerationUserListArgs extends AdminModerationUserFilter {
  readonly after?: string | undefined;
}

export interface AdminModerationUserView {
  readonly id: string;
  readonly handle: string;
  readonly nickname: string;
  readonly avatar: AdminMediaFileView | null;
  readonly registeredAt: string;
  readonly disposableEmail: DisposableEmailJudgement;
  readonly status: AdminUserStatusValue;
  readonly suspendedAt: string | null;
  // 停止中で、停止の措置の記録が残っている利用者だけが持つ
  readonly latestSuspension: ModerationNoteView | null;
}

export type AdminModerationUserPage =
  AdminModerationPage<AdminModerationUserView>;

export type UserModerationAction = Extract<ModerationAction, `user.${string}`>;

type UserNode = AdminUsersQuery['adminUsers']['nodes'][number];

const STATUS_OF = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const satisfies Record<AdminUserStatus, AdminUserStatusValue>);

const GRAPHQL_STATUS_OF = Object.freeze({
  active: 'ACTIVE',
  suspended: 'SUSPENDED',
} as const satisfies Record<AdminUserStatusValue, AdminUserStatus>);

const DISPOSABLE_EMAIL_OF = Object.freeze({
  DISPOSABLE: 'disposable',
  REGULAR: 'regular',
  UNDETERMINED: 'undetermined',
  UNVERIFIED: 'unverified',
} as const satisfies Record<DisposableEmailCheck, DisposableEmailJudgement>);

const variablesOf = ({
  handle,
  nickname,
  email,
  status,
  after,
}: AdminModerationUserListArgs): AdminUsersQueryVariables => {
  const filter: AdminUserFilter = {
    ...(handle !== undefined && { handle }),
    ...(nickname !== undefined && { nickname }),
    ...(email !== undefined && { email }),
    ...(status !== undefined && { status: GRAPHQL_STATUS_OF[status] }),
  };
  return {
    filter,
    first: ADMIN_LIST_PAGE_SIZE,
    ...(after !== undefined && { after }),
  };
};

export const adminModerationUsersQueryOptions = (
  args: AdminModerationUserListArgs,
) => graphqlQueryOptions(AdminUsersDocument, variablesOf(args));

const toUser = (node: UserNode): AdminModerationUserView => ({
  id: node.id,
  handle: node.handle,
  nickname: node.nickname,
  avatar: toAdminMediaFile(node.avatar),
  registeredAt: node.registeredAt,
  disposableEmail: DISPOSABLE_EMAIL_OF[node.disposableEmail],
  status: STATUS_OF[node.status],
  suspendedAt: node.suspendedAt,
  latestSuspension: toModerationNote(node.latestSuspension),
});

export const toAdminModerationUserPage = ({
  adminUsers,
}: AdminUsersQuery): AdminModerationUserPage =>
  toModerationPage(adminUsers, toUser);

const USER_ACTION_OPTIONS: Readonly<
  Record<UserModerationAction, ModerationActionOptions>
> = Object.freeze({
  'user.suspend': moderationActionOptions({
    document: AdminSuspendUserDocument,
    variablesOf: ({ targetId, reason }) => ({ id: targetId, reason }),
    outcomeOf: ({ suspendUser }) => suspendUser,
  }),
  'user.unsuspend': moderationActionOptions({
    document: AdminUnsuspendUserDocument,
    variablesOf: ({ targetId, reason }) => ({ id: targetId, reason }),
    outcomeOf: ({ unsuspendUser }) => unsuspendUser,
  }),
  'user.administrative-withdraw': moderationActionOptions({
    document: AdminWithdrawUserByAdministratorDocument,
    variablesOf: ({ targetId, reason }) => ({
      input: { userId: targetId, reason },
    }),
    outcomeOf: ({ withdrawUserByAdministrator }) => withdrawUserByAdministrator,
  }),
});

export const userModerationActionOptions = (
  action: UserModerationAction,
): ModerationActionOptions => USER_ACTION_OPTIONS[action];

export async function invalidateAdminModerationUserQueries(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: [documentIdOf(AdminUsersDocument)],
  });
}

// 一覧の取得の失敗は一覧の中で再試行できるよう、例外にせずキャッシュに残す。
// 同じ画面の中の条件の変更とページの移動で待つと、ルーターが前の条件の画面を保ったまま待ち、画面が直前の一覧を残して読み込み中を示せないため、取得を始めるだけにする
export async function loadAdminModerationUsersPage({
  context,
  deps,
  cause,
}: {
  readonly context: Pick<RouterContext, 'queryClient'>;
  readonly deps: AdminModerationUserListArgs;
  readonly cause: 'preload' | 'enter' | 'stay';
}): Promise<void> {
  const loading = context.queryClient
    .query(adminModerationUsersQueryOptions(deps))
    .catch(() => undefined);
  if (cause !== 'stay') {
    await loading;
  }
}
