import type { GraphQLResolveInfo } from 'graphql';

import type { AccountGuard } from '../../../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../../../lib/core/identity/identifiers.ts';
import { PLATFORM_TYPES } from '../../../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../../../lib/core/time/clock.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { callerForbiddenError } from './errors.ts';

// 期待する操作名は、利用者側の画面がbot判定の部品に渡す名前と同じにする
export const MATCH_BOT_ACTIONS = Object.freeze({
  upvote: 'match_upvote',
});

export type MatchBotAction =
  (typeof MATCH_BOT_ACTIONS)[keyof typeof MATCH_BOT_ACTIONS];

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

// 利用者側の操作は利用者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とbot判定より前に拒否する
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

export function assertHuman(
  context: GraphQLContext,
  action: MatchBotAction,
): Promise<void> {
  return context.assertHuman(action);
}

export const accountGuardOf = (context: GraphQLContext): AccountGuard =>
  context.resolve<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard);

export const clockOf = (context: GraphQLContext): Clock =>
  context.resolve<Clock>(PLATFORM_TYPES.Clock);
