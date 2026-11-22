import type { GraphQLResolveInfo } from 'graphql';

import { authError } from '../../../../application/auth/auth-errors.ts';
import type { GraphQLContext } from '../../graphql-context.ts';

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

// データエクスポートは利用者側のフロントエンドサーバーからの要求だけで受け付ける。入力の検証とログインの確認より前に拒否する
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
