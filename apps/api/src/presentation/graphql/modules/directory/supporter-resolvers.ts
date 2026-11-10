import { DIRECTORY_TYPES } from '../../../../application/directory/directory-types.ts';
import type { SupporterListReader } from '../../../../application/directory/supporter-list-reader.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import { encodeCursor } from '../../pagination.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { userSummaryLoader } from '../profile/user-summary.ts';
import { MATCH_SUPPORTERS_ARGS, supporterListPositionOf } from './inputs.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

// ログインを求めない。位置は引数の検証の後に戻し、壊れた位置はinvalid_cursorで拒否する。照会の後に退会・停止した利用者は一覧から除く
export const supporterResolvers = {
  Query: {
    matchSupporters: clientOnly(
      withValidatedArgs(
        MATCH_SUPPORTERS_ARGS,
        async (_parent: unknown, args, context) => {
          const after = supporterListPositionOf(args.after);
          const viewer = await accountGuardOf(context).currentUser(
            context.session,
          );
          const page = await context
            .resolve<SupporterListReader>(DIRECTORY_TYPES.SupporterListReader)
            .list({
              productHandle: args.productHandle,
              matchId: args.matchId,
              entryId: args.entryId,
              viewer,
              first: args.first,
              after,
              now: clockOf(context).now(),
            });
          if (page === null) {
            return null;
          }
          const summaries = await Promise.all(
            page.userIds.map((userId) =>
              context.loaders.get(userSummaryLoader).load(userId),
            ),
          );
          return {
            nodes: summaries.filter((summary) => summary !== null),
            pageInfo: {
              hasNextPage: page.hasNextPage,
              endCursor:
                page.endCursor === null
                  ? null
                  : encodeCursor({
                      upvotedAt: page.endCursor.upvotedAt,
                      upvoteId: page.endCursor.upvoteId,
                    }),
            },
          };
        },
      ),
    ),
  },
} satisfies Resolvers;
