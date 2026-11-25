import type { AdminCommentReader } from '../../../../application/moderation/admin-comment-reader.ts';
import type { AdminRatingReader } from '../../../../application/moderation/admin-rating-reader.ts';
import type { CommentModerationService } from '../../../../application/moderation/comment-moderation-service.ts';
import { MODERATION_TYPES } from '../../../../application/moderation/moderation-types.ts';
import type { ModerationCommand } from '../../../../application/moderation/ports.ts';
import type { RatingModerationService } from '../../../../application/moderation/rating-moderation-service.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  toAdminComment,
  toAdminRatingConnection,
  toConnectionResult,
} from './content-views.ts';
import {
  ADMIN_COMMENTS_ARGS,
  ADMIN_RATINGS_ARGS,
  COMMENT_MODERATION_ARGS,
  RATING_MODERATION_ARGS,
} from './inputs.ts';
import {
  adminOnly,
  clockOf,
  moderationOperatorOf,
} from './resolver-support.ts';

const commentReaderOf = (context: GraphQLContext): AdminCommentReader =>
  context.resolve<AdminCommentReader>(MODERATION_TYPES.AdminCommentReader);

const ratingReaderOf = (context: GraphQLContext): AdminRatingReader =>
  context.resolve<AdminRatingReader>(MODERATION_TYPES.AdminRatingReader);

const commentModerationOf = (
  context: GraphQLContext,
): CommentModerationService =>
  context.resolve<CommentModerationService>(
    MODERATION_TYPES.CommentModerationService,
  );

const ratingModerationOf = (context: GraphQLContext): RatingModerationService =>
  context.resolve<RatingModerationService>(
    MODERATION_TYPES.RatingModerationService,
  );

async function targetCommandOf(
  context: GraphQLContext,
  { id, reason }: { readonly id: string; readonly reason: string },
): Promise<ModerationCommand> {
  const operator = await moderationOperatorOf(context, 'moderator');
  return { targetId: id, reason, operator, at: clockOf(context).now() };
}

// コメントと評価の一覧は閲覧のみ以上、措置はモデレーター以上に許す。各リゾルバはadminOnlyで包み、入力の検証より前に管理者側以外の呼び出しを拒否する
export const engagementResolvers = {
  Query: {
    adminComments: adminOnly(
      withValidatedArgs(
        ADMIN_COMMENTS_ARGS,
        async (_parent: unknown, { filter, first, after }, context) => {
          await moderationOperatorOf(context, 'viewer');
          const page = await commentReaderOf(context).list({
            filter,
            first,
            ...(after !== undefined && { after }),
            now: clockOf(context).now(),
          });
          return toConnectionResult(
            page.comments,
            page.nextCursor,
            toAdminComment,
          );
        },
      ),
    ),
    adminRatings: adminOnly(
      withValidatedArgs(
        ADMIN_RATINGS_ARGS,
        async (_parent: unknown, { filter, first, after }, context) => {
          await moderationOperatorOf(context, 'viewer');
          return toAdminRatingConnection(
            await ratingReaderOf(context).list({
              filter,
              first,
              ...(after !== undefined && { after }),
            }),
          );
        },
      ),
    ),
  },
  Mutation: {
    hideComment: adminOnly(
      withValidatedArgs(
        COMMENT_MODERATION_ARGS,
        async (_parent: unknown, args, context) => {
          const { changed } = await commentModerationOf(context).hide(
            await targetCommandOf(context, args),
          );
          return { changed };
        },
      ),
    ),
    unhideComment: adminOnly(
      withValidatedArgs(
        COMMENT_MODERATION_ARGS,
        async (_parent: unknown, args, context) => {
          const { changed } = await commentModerationOf(context).unhide(
            await targetCommandOf(context, args),
          );
          return { changed };
        },
      ),
    ),
    invalidateRating: adminOnly(
      withValidatedArgs(
        RATING_MODERATION_ARGS,
        async (_parent: unknown, args, context) => {
          const { changed } = await ratingModerationOf(context).invalidate(
            await targetCommandOf(context, args),
          );
          return { changed };
        },
      ),
    ),
    revalidateRating: adminOnly(
      withValidatedArgs(
        RATING_MODERATION_ARGS,
        async (_parent: unknown, args, context) => {
          const { changed } = await ratingModerationOf(context).revalidate(
            await targetCommandOf(context, args),
          );
          return { changed };
        },
      ),
    ),
  },
} satisfies Resolvers;
