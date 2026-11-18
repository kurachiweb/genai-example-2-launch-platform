import type { ProductTrophyReader } from '../../../../application/tournament/product-trophy-reader.ts';
import { WEEK_TOURNAMENT_API_TYPES } from '../../../../application/week-tournament/week-tournament-api-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { toTrophy } from './mappers.ts';
import { accountGuardOf, clientOnly } from '../tournament/resolver-support.ts';

const readerOf = (context: GraphQLContext): ProductTrophyReader =>
  context.resolve<ProductTrophyReader>(
    WEEK_TOURNAMENT_API_TYPES.ProductTrophyReader,
  );

// ログインを求めない。詳細ページと同じ公開範囲で、閲覧できないプロダクトは理由を区別せずnullにする
export const trophyResolvers = {
  Query: {
    productTrophies: clientOnly(
      async (_parent: unknown, args: { productHandle: string }, context) => {
        const viewer = await accountGuardOf(context).currentUser(
          context.session,
        );
        const trophies = await readerOf(context).read(
          args.productHandle,
          viewer,
        );
        return trophies === null ? null : trophies.map(toTrophy);
      },
    ),
  },
} satisfies Resolvers;
