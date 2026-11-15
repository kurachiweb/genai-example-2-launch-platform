import type { CommentReader } from '../../../../application/engagement/comment-reader.ts';
import { ENGAGEMENT_TYPES } from '../../../../application/engagement/engagement-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { toLaunchCommentConnection } from './engagement-views.ts';
import { LAUNCH_COMMENT_COUNTS_ARGS, LAUNCH_COMMENTS_ARGS } from './inputs.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

const readerOf = (context: GraphQLContext): CommentReader =>
  context.resolve<CommentReader>(ENGAGEMENT_TYPES.CommentReader);

// ログインを求めず、投稿者本人の未掲載のプロダクトと「あなた」の判定だけをセッションの利用者で変える
export const commentResolvers = {
  Query: {
    launchComments: clientOnly(
      withValidatedArgs(
        LAUNCH_COMMENTS_ARGS,
        async (_parent: unknown, { productId, launchId, after }, context) => {
          const viewer = await accountGuardOf(context).currentUser(
            context.session,
          );
          const page = await readerOf(context).page({
            productId,
            launchId,
            viewer,
            after,
            now: clockOf(context).now(),
          });
          return page === null ? null : toLaunchCommentConnection(page);
        },
      ),
    ),
    launchCommentCounts: clientOnly(
      withValidatedArgs(
        LAUNCH_COMMENT_COUNTS_ARGS,
        async (_parent: unknown, { productId }, context) => {
          const viewer = await accountGuardOf(context).currentUser(
            context.session,
          );
          const counts = await readerOf(context).counts({
            productId,
            viewer,
            now: clockOf(context).now(),
          });
          return counts === null ? null : [...counts];
        },
      ),
    ),
  },
} satisfies Resolvers;
