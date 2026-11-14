import type { GraphQLResolveInfo } from 'graphql';

import type { CallerKind } from '../../../gateway/gateway-headers.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { callerForbiddenError } from './errors.ts';

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

// 利用者側の照会は利用者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証より前に拒否する
export const clientOnly = callerOnly('client');

// 管理者側の操作は管理者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とロールの確認より前に拒否する
export const adminOnly = callerOnly('admin');
