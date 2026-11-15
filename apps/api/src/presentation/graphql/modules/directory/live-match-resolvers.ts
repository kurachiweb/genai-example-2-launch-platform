import { DIRECTORY_TYPES } from '../../../../application/directory/directory-types.ts';
import type { LiveMatchReader } from '../../../../application/directory/live-match-reader.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import { toProductLiveMatch } from './product-page-mappers.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

// ログインを求めない。定期の取り直しの対象のため、詳細ページの取得と分けて開催中のマッチだけを返す
export const liveMatchResolvers = {
  Query: {
    productLiveMatch: clientOnly(
      async (_parent: unknown, args: { productHandle: string }, context) => {
        const viewer = await accountGuardOf(context).currentUser(
          context.session,
        );
        const view = await context
          .resolve<LiveMatchReader>(DIRECTORY_TYPES.LiveMatchReader)
          .read({
            productHandle: args.productHandle,
            viewer,
            now: clockOf(context).now(),
          });
        return view === null ? null : toProductLiveMatch(view);
      },
    ),
  },
} satisfies Resolvers;
