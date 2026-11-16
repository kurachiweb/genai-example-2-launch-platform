import { ENGAGEMENT_TYPES } from '../../../../application/engagement/engagement-types.ts';
import type { RatingService } from '../../../../application/engagement/rating-service.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  CANCEL_PRODUCT_RATING_ARGS,
  PRODUCT_RATING_ARGS,
  RATE_PRODUCT_ARGS,
} from './inputs.ts';
import { accountGuardOf, clientOnly, clockOf } from './resolver-support.ts';

const serviceOf = (context: GraphQLContext): RatingService =>
  context.resolve<RatingService>(ENGAGEMENT_TYPES.RatingService);

// 単独の評価と取消にはbot対策を課さない。評価はメールアドレスの確認・1人1件・自身のプロダクトの拒否・管理者の無効化で守る
export const ratingResolvers = {
  Query: {
    productRating: clientOnly(
      withValidatedArgs(
        PRODUCT_RATING_ARGS,
        async (_parent: unknown, { productId }, context) => {
          const viewer = await accountGuardOf(context).currentUser(
            context.session,
          );
          return serviceOf(context).read({
            productId,
            viewer,
            now: clockOf(context).now(),
          });
        },
      ),
    ),
  },
  // ユースケースはメールアドレスの確認を判定せず、未確認の評価は書き込みの条件でaccount_unavailableになるため、ここで先に判定する
  Mutation: {
    rateProduct: clientOnly(
      withValidatedArgs(
        RATE_PRODUCT_ARGS,
        async (_parent: unknown, { productId, score }, context) => {
          const user = await accountGuardOf(context).requireVerifiedUser(
            context.session,
          );
          return serviceOf(context).rate({
            user,
            productId,
            score,
            now: clockOf(context).now(),
          });
        },
      ),
    ),
    // 取消はメールアドレスの確認を求めない
    cancelProductRating: clientOnly(
      withValidatedArgs(
        CANCEL_PRODUCT_RATING_ARGS,
        async (_parent: unknown, { productId }, context) => {
          const user = await accountGuardOf(context).requireWritableUser(
            context.session,
          );
          return serviceOf(context).cancel({
            user,
            productId,
            now: clockOf(context).now(),
          });
        },
      ),
    ),
  },
} satisfies Resolvers;
