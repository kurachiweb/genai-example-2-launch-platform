import { COMMENT_BOT_ACTIONS } from '../../../../../common-lib/engagement/engagement-rules.ts';
import type { CommentReader } from '../../../../application/engagement/comment-reader.ts';
import type {
  CommentPostResult,
  CommentService,
} from '../../../../application/engagement/comment-service.ts';
import { ENGAGEMENT_TYPES } from '../../../../application/engagement/engagement-types.ts';
import { withInputPath } from '../../field-paths.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  type CommentMutationResultModel,
  toLaunchCommentConnection,
} from './engagement-views.ts';
import {
  DELETE_COMMENT_ARGS,
  LAUNCH_COMMENT_COUNTS_ARGS,
  LAUNCH_COMMENTS_ARGS,
  POST_COMMENT_ARGS,
  UPDATE_COMMENT_ARGS,
} from './inputs.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

const readerOf = (context: GraphQLContext): CommentReader =>
  context.resolve<CommentReader>(ENGAGEMENT_TYPES.CommentReader);

const serviceOf = (context: GraphQLContext): CommentService =>
  context.resolve<CommentService>(ENGAGEMENT_TYPES.CommentService);

// ユースケースの返信への評価の違反は入力からの相対の欄で返るため、引数の検証と同じinputの下の欄に直す
const INPUT_ARGUMENT = 'input';

const toMutationResult = ({
  comment,
  rating,
}: CommentPostResult): CommentMutationResultModel => ({
  comment,
  rating: rating ?? null,
});

export const commentResolvers = {
  // ログインを求めず、投稿者本人の未掲載のプロダクトと「あなた」の判定だけをセッションの利用者で変える
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
  // 本文の規則と利用者の状態はユースケースが確かめないため、ここで判定する。
  // bot判定は利用者の状態の確認の後に行い、拒否できる要求でトークンを消費させない
  Mutation: {
    postComment: clientOnly(
      withValidatedArgs(
        POST_COMMENT_ARGS,
        async (_parent: unknown, { input }, context) => {
          const user = await accountGuardOf(context).requireVerifiedUser(
            context.session,
          );
          await context.assertHuman(COMMENT_BOT_ACTIONS.post);
          const result = await withInputPath(INPUT_ARGUMENT, () =>
            serviceOf(context).post({
              user,
              productId: input.productId,
              launchId: input.launchId,
              parentId: input.parentId,
              body: input.body,
              rating: input.rating,
              now: clockOf(context).now(),
            }),
          );
          return toMutationResult(result);
        },
      ),
    ),
    updateComment: clientOnly(
      withValidatedArgs(
        UPDATE_COMMENT_ARGS,
        async (_parent: unknown, { input }, context) => {
          const user = await accountGuardOf(context).requireVerifiedUser(
            context.session,
          );
          await context.assertHuman(COMMENT_BOT_ACTIONS.edit);
          const result = await withInputPath(INPUT_ARGUMENT, () =>
            serviceOf(context).update({
              user,
              commentId: input.commentId,
              body: input.body,
              rating: input.rating,
              now: clockOf(context).now(),
            }),
          );
          return toMutationResult(result);
        },
      ),
    ),
    // 削除はメールアドレスの確認を求めない
    deleteComment: clientOnly(
      withValidatedArgs(
        DELETE_COMMENT_ARGS,
        async (_parent: unknown, { commentId }, context) => {
          const user = await accountGuardOf(context).requireWritableUser(
            context.session,
          );
          await context.assertHuman(COMMENT_BOT_ACTIONS.delete);
          return serviceOf(context).remove({
            user,
            commentId,
            now: clockOf(context).now(),
          });
        },
      ),
    ),
  },
} satisfies Resolvers;
