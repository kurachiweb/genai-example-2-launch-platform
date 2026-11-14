import type { LaunchHistoryReader } from '../../../../application/product/launch-history-reader.ts';
import { PRODUCT_TYPES } from '../../../../application/product/product-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { LAUNCH_HISTORY_ARGS, PROFILE_AWARDS_ARGS } from './inputs.ts';
import { toLaunchHistoryConnection, toProductAward } from './mappers.ts';
import { clientOnly } from './resolver-support.ts';

const readerOf = (context: GraphQLContext): LaunchHistoryReader =>
  context.resolve<LaunchHistoryReader>(PRODUCT_TYPES.LaunchHistoryReader);

// ログインを求めず、閲覧者が本人かどうかで対象を変える。表示できない利用者はnullで、壊れた位置はinvalid_cursorで拒否する
export const launchHistoryResolvers = {
  Query: {
    launchHistory: clientOnly(
      withValidatedArgs(
        LAUNCH_HISTORY_ARGS,
        async (_parent: unknown, { userHandle, first, after }, context) => {
          const page = await readerOf(context).list(context.session, {
            userHandle,
            first,
            after,
          });
          return page === null ? null : toLaunchHistoryConnection(page);
        },
      ),
    ),
    profileAwards: clientOnly(
      withValidatedArgs(
        PROFILE_AWARDS_ARGS,
        async (_parent: unknown, { userHandle }, context) => {
          const groups = await readerOf(context).awards(context.session, {
            userHandle,
          });
          return groups === null ? null : groups.map(toProductAward);
        },
      ),
    ),
  },
} satisfies Resolvers;
