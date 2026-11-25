import type { GraphQLResolveInfo } from 'graphql';

import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../../../lib/core/identity/identifiers.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import type { AdminRoleRequirement } from '../../../../application/sponsorship/admin-sponsorships-reader.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';
import { requireAdmin } from '../../admin-guard.ts';
import type { CallerKind } from '../../../gateway/gateway-headers.ts';
import type { GraphQLContext } from '../../graphql-context.ts';

// 期待する操作名は、利用者側の画面がbot判定の部品に渡す名前と同じにする
export const SPONSORSHIP_APPLY_BOT_ACTION = 'sponsorship_apply';

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

function callerOnly(caller: CallerKind) {
  return <TParent, TArgs, TResult>(
      resolve: Resolver<TParent, TArgs, Promise<TResult>>,
    ): Resolver<TParent, TArgs, Promise<TResult>> =>
    async (parent, args, context, info) => {
      if (context.caller !== caller) {
        throw authError('forbidden');
      }
      return resolve(parent, args, context, info);
    };
}

// 利用者側の操作は利用者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とbot判定より前に拒否する
export const clientOnly = callerOnly('client');

// 管理者側の操作は管理者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とロールの確認より前に拒否する
export const adminOnly = callerOnly('admin');

// ユースケースが宣言する最低限のロールで、ロールの不足の拒否のログを残す認可の入口を呼ぶ
export const roleRequirementOf =
  (context: GraphQLContext): AdminRoleRequirement =>
  (minimum) =>
    requireAdmin(context, minimum);

export const accountGuardOf = (context: GraphQLContext): AccountGuard =>
  context.resolve<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard);

export const clockOf = (context: GraphQLContext): Clock =>
  context.resolve<Clock>(PLATFORM_TYPES.Clock);
