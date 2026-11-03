import type { GraphQLResolveInfo } from 'graphql';

import type { AdminRole } from '../../../../../common-lib/admin/admin-roles.ts';
import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import { adminError } from '../../../../application/admin/admin-errors.ts';
import { ADMIN_TYPES } from '../../../../application/admin/admin-types.ts';
import type {
  AdminAccountStore,
  AdminRecord,
  AdminRequestMeta,
  IssuedAdminSession,
} from '../../../../application/admin/ports.ts';
import type { Principal } from '../../../../application/session/session-verifier.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type { GraphQLContext } from '../../graphql-context.ts';

// 期待する操作名は、管理者側の画面がbot判定の部品に渡す名前と同じにする。利用者側の操作の判定の結果を流用させないよう、利用者側と別の名前にする
export const ADMIN_BOT_ACTIONS = Object.freeze({
  login: 'admin_login',
  passwordReset: 'admin_password_reset',
});

export type AdminBotAction =
  (typeof ADMIN_BOT_ACTIONS)[keyof typeof ADMIN_BOT_ACTIONS];

export type AdminRoleValue = 'VIEWER' | 'MODERATOR' | 'SUPER_ADMIN';

export const ADMIN_ROLE_VALUES: Readonly<Record<AdminRole, AdminRoleValue>> =
  Object.freeze({
    viewer: 'VIEWER',
    moderator: 'MODERATOR',
    super_admin: 'SUPER_ADMIN',
  });

export interface AdminViewerSource {
  readonly id: string;
  readonly nickname: string;
  readonly title: string | null;
  readonly email: string;
  readonly role: AdminRoleValue;
  readonly avatarFileId: string | null;
}

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

// 管理者の操作は管理者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とbot判定より前に拒否する
export function adminOnly<TParent, TArgs, TResult>(
  resolve: Resolver<TParent, TArgs, Promise<TResult>>,
): Resolver<TParent, TArgs, Promise<TResult>> {
  return async (parent, args, context, info) => {
    if (context.caller !== 'admin') {
      throw adminError('forbidden');
    }
    return resolve(parent, args, context, info);
  };
}

export function adminRequestMetaOf(context: GraphQLContext): AdminRequestMeta {
  return {
    clientIp: context.clientIp,
    userAgent: context.userAgent,
    now: context.resolve<Clock>(PLATFORM_TYPES.Clock).now(),
  };
}

export function assertHuman(
  context: GraphQLContext,
  action: AdminBotAction,
): Promise<void> {
  return context.assertHuman(action);
}

export function issueSession(
  context: GraphQLContext,
  session: IssuedAdminSession,
): void {
  context.session.issue({
    token: session.token,
    maxAgeSeconds: session.maxAgeSeconds,
  });
}

export const adminAccountStoreOf = (
  context: GraphQLContext,
): AdminAccountStore =>
  context.resolve<AdminAccountStore>(ADMIN_TYPES.AdminAccountStore);

function toAdminViewer(admin: AdminRecord): AdminViewerSource {
  // 有効化はニックネームの仮の保存を条件にするため、有効な管理者にニックネームが無いのはデータの不整合である
  if (admin.nickname === null) {
    throw new Error('有効な管理者にニックネームがありません');
  }
  return {
    id: admin.id,
    nickname: admin.nickname,
    title: admin.title,
    email: admin.email,
    role: ADMIN_ROLE_VALUES[admin.role],
    avatarFileId: admin.avatarFileId,
  };
}

// セッションを発行した直後の要求はまだ元のセッションのままのため、管理者の識別子から読み直す
export async function loadAdminViewer(
  context: GraphQLContext,
  adminId: string,
): Promise<AdminViewerSource> {
  const admin = await adminAccountStoreOf(context).findById(adminId);
  if (admin?.status !== 'active') {
    throw new Error('セッションを発行した管理者を読み込めませんでした');
  }
  return toAdminViewer(admin);
}

// 未ログインは画面の出し分けに使う通常の状態のため、エラーにせずnullを返す
export async function currentAdminViewer(
  context: GraphQLContext,
): Promise<AdminViewerSource | null> {
  try {
    const current = await requireAdmin(context, 'viewer');
    return await loadAdminViewer(context, current.id);
  } catch (error: unknown) {
    if (error instanceof AppError && error.code === 'unauthenticated') {
      return null;
    }
    throw error;
  }
}

export interface AdminConfirmationResultSource {
  readonly viewer: AdminViewerSource | null;
}

// ユースケースは確定の操作をした端末が同じ管理者としてログイン中のときだけセッションを発行するため、発行したときだけその管理者を返す
export async function adminConfirmationResult(
  context: GraphQLContext,
  operator: Principal,
  session: IssuedAdminSession | undefined,
): Promise<AdminConfirmationResultSource> {
  if (session === undefined || operator.kind !== 'authenticated') {
    return { viewer: null };
  }
  issueSession(context, session);
  return { viewer: await loadAdminViewer(context, operator.subjectId) };
}
