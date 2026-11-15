import type { GraphQLResolveInfo } from 'graphql';

import type { AccountGuard } from '../../../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../../../lib/core/identity/identifiers.ts';
import type { CallerKind } from '../../../gateway/gateway-headers.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { callerForbiddenError } from './errors.ts';

// 期待する操作名は、利用者側の画面がbot判定の部品に渡す名前と同じにする
export const PRODUCT_BOT_ACTIONS = Object.freeze({
  save: 'product_save',
  delete: 'product_delete',
});

export type ProductBotAction =
  (typeof PRODUCT_BOT_ACTIONS)[keyof typeof PRODUCT_BOT_ACTIONS];

export function assertHuman(
  context: GraphQLContext,
  action: ProductBotAction,
): Promise<void> {
  return context.assertHuman(action);
}

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
        throw callerForbiddenError();
      }
      return resolve(parent, args, context, info);
    };
}

// 利用者側の操作は利用者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とbot判定より前に拒否する
export const clientOnly = callerOnly('client');

// 管理者側の操作は管理者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とロールの確認より前に拒否する
export const adminOnly = callerOnly('admin');

export const accountGuardOf = (context: GraphQLContext): AccountGuard =>
  context.resolve<AccountGuard>(IDENTITY_PLATFORM_TYPES.AccountGuard);
