import type { GraphQLResolveInfo } from 'graphql';

import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../../../lib/core/identity/identifiers.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';
import type { GraphQLContext } from '../../graphql-context.ts';

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

// 利用者側の操作は利用者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証より前に拒否する
export function clientOnly<TParent, TArgs, TResult>(
  resolve: Resolver<TParent, TArgs, Promise<TResult>>,
): Resolver<TParent, TArgs, Promise<TResult>> {
  return async (parent, args, context, info) => {
    if (context.caller !== 'client') {
      throw authError('forbidden');
    }
    return resolve(parent, args, context, info);
  };
}

export const accountGuardOf = (context: GraphQLContext): AccountGuard =>
  context.resolve<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard);

export const clockOf = (context: GraphQLContext): Clock =>
  context.resolve<Clock>(PLATFORM_TYPES.Clock);
