import { MATCH_TYPES } from '../../../../application/match/match-types.ts';
import type { UpvoteHistoryReader } from '../../../../application/match/upvote-history-reader.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { UPVOTE_HISTORY_ARGS } from './inputs.ts';
import { toUpvoteHistoryConnection } from './mappers.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

const readerOf = (context: GraphQLContext): UpvoteHistoryReader =>
  context.resolve<UpvoteHistoryReader>(MATCH_TYPES.UpvoteHistoryReader);

// ログインを求めず、停止中の利用者を本人にだけ返すため閲覧者を渡す。表示できない利用者はnullで、壊れた位置はinvalid_cursorで拒否する
export const upvoteHistoryResolvers = {
  Query: {
    upvoteHistory: clientOnly(
      withValidatedArgs(
        UPVOTE_HISTORY_ARGS,
        async (_parent: unknown, { userHandle, first, after }, context) => {
          const viewer = await accountGuardOf(context).currentUser(
            context.session,
          );
          const page = await readerOf(context).read({
            userHandle,
            viewer,
            first,
            after,
            now: clockOf(context).now(),
          });
          return page === null ? null : toUpvoteHistoryConnection(page);
        },
      ),
    ),
  },
} satisfies Resolvers;
