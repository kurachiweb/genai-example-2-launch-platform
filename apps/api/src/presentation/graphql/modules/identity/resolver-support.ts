import type { GraphQLResolveInfo } from 'graphql';

import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import { IDENTITY_TYPES } from '../../../../application/identity/identity-types.ts';
import type {
  RecoveryCodeStore,
  TotpCredentialStore,
  UserAccountStore,
  UserRecord,
} from '../../../../application/identity/ports.ts';
import type { RequestMeta } from '../../../../application/identity/request-meta.ts';
import { isTotpEnabled } from '../../../../application/identity/second-factor-check.ts';
import type { IssuedSession } from '../../../../application/identity/session-issuer.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { callerForbiddenError } from './errors.ts';

// 期待する操作名は、フロントエンドがbot判定の部品に渡す名前と同じにする
export const BOT_ACTIONS = Object.freeze({
  register: 'register',
  login: 'login',
  passwordReset: 'password_reset',
  emailChange: 'email_change',
  passwordChange: 'password_change',
  withdraw: 'withdraw',
});

export type BotAction = (typeof BOT_ACTIONS)[keyof typeof BOT_ACTIONS];

export type AccountStatusValue = 'ACTIVE' | 'SUSPENDED';

export interface ViewerSource {
  readonly id: string;
  readonly handle: string;
  readonly nickname: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly status: AccountStatusValue;
}

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

const ACCOUNT_STATUS_VALUES: Readonly<
  Record<UserRecord['status'], AccountStatusValue>
> = Object.freeze({ active: 'ACTIVE', suspended: 'SUSPENDED' });

// 利用者の操作は利用者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とbot判定より前に拒否する
export function clientOnly<TParent, TArgs, TResult>(
  resolve: Resolver<TParent, TArgs, Promise<TResult>>,
): Resolver<TParent, TArgs, Promise<TResult>> {
  return async (parent, args, context, info) => {
    if (context.caller !== 'client') {
      throw callerForbiddenError();
    }
    return resolve(parent, args, context, info);
  };
}

export function requestMetaOf(context: GraphQLContext): RequestMeta {
  return {
    clientIp: context.clientIp,
    userAgent: context.userAgent,
    now: context.resolve<Clock>(PLATFORM_TYPES.Clock).now(),
  };
}

export function assertHuman(
  context: GraphQLContext,
  action: BotAction,
): Promise<void> {
  return context.assertHuman(action);
}

export function issueSession(
  context: GraphQLContext,
  session: IssuedSession,
): void {
  context.session.issue({
    token: session.token,
    maxAgeSeconds: session.maxAgeSeconds,
  });
}

export function toViewer(user: UserRecord): ViewerSource {
  return {
    id: user.id,
    handle: user.handle,
    nickname: user.nickname,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    status: ACCOUNT_STATUS_VALUES[user.status],
  };
}

// セッションを発行した直後の要求はまだ元のセッションのままのため、利用者の識別子から読み直す
export async function loadViewer(
  context: GraphQLContext,
  userId: string,
): Promise<ViewerSource> {
  const user = await context
    .resolve<UserAccountStore>(IDENTITY_TYPES.UserAccountStore)
    .findById(userId);
  if (user === undefined) {
    throw new Error('セッションを発行した利用者を読み込めませんでした');
  }
  return toViewer(user);
}

export async function isViewerTotpEnabled(
  context: GraphQLContext,
  userId: string,
): Promise<boolean> {
  const credential = await context
    .resolve<TotpCredentialStore>(IDENTITY_TYPES.TotpCredentialStore)
    .find(userId);
  return isTotpEnabled(credential);
}

export async function countRemainingRecoveryCodes(
  context: GraphQLContext,
  userId: string,
): Promise<number> {
  if (!(await isViewerTotpEnabled(context, userId))) {
    return 0;
  }
  return context
    .resolve<RecoveryCodeStore>(IDENTITY_TYPES.RecoveryCodeStore)
    .count(userId);
}
