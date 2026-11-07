import type { GraphQLResolveInfo } from 'graphql';

import type { UltrasCheckout } from '../../../../application/ultras/ultras-checkout.ts';
import type { UltrasPlanReader } from '../../../../application/ultras/ultras-plan-reader.ts';
import { API_ULTRAS_TYPES } from '../../../../application/ultras/ultras-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { callerForbiddenError } from './errors.ts';
import { toUltrasOffer, toViewerUltras } from './mappers.ts';

type Resolver<TParent, TArgs, TResult> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
  info: GraphQLResolveInfo,
) => TResult;

// 利用者側の操作は利用者側のフロントエンドサーバーからの要求だけで受け付ける。ログインの確認より前に拒否する
function clientOnly<TParent, TArgs, TResult>(
  resolve: Resolver<TParent, TArgs, Promise<TResult>>,
): Resolver<TParent, TArgs, Promise<TResult>> {
  return async (parent, args, context, info) => {
    if (context.caller !== 'client') {
      throw callerForbiddenError();
    }
    return resolve(parent, args, context, info);
  };
}

const planReaderOf = (context: GraphQLContext): UltrasPlanReader =>
  context.resolve<UltrasPlanReader>(API_ULTRAS_TYPES.UltrasPlanReader);

const checkoutOf = (context: GraphQLContext): UltrasCheckout =>
  context.resolve<UltrasCheckout>(API_ULTRAS_TYPES.UltrasCheckout);

// ユースケースはGraphQLContextを受け取らないため、解決関数がセッションを取り出して渡す
export const ultrasResolvers = {
  Query: {
    ultrasOffer: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) =>
        toUltrasOffer(await planReaderOf(context).offer()),
    ),
    viewerUltras: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const view = await planReaderOf(context).viewer(context.session);
        return view === null ? null : toViewerUltras(view);
      },
    ),
  },
  Mutation: {
    startUltrasCheckout: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        const { purchaseId } = await checkoutOf(context).start(context.session);
        return { purchaseId };
      },
    ),
  },
} satisfies Resolvers;
