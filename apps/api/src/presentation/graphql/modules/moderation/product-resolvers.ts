import type { AdminProductReader } from '../../../../application/moderation/admin-product-reader.ts';
import type { AdminRatingReader } from '../../../../application/moderation/admin-rating-reader.ts';
import { MODERATION_TYPES } from '../../../../application/moderation/moderation-types.ts';
import type { ProductModerationService } from '../../../../application/moderation/product-moderation-service.ts';
import type { ModerationCommand } from '../../../../application/moderation/ports.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import {
  toAdminProduct,
  toConnectionResult,
  toAdminProductDetail,
  toAdminRatingConnection,
} from './content-views.ts';
import {
  ADMIN_PRODUCT_ARGS,
  ADMIN_PRODUCT_RATINGS_ARGS,
  ADMIN_PRODUCTS_ARGS,
  PRODUCT_MODERATION_ARGS,
} from './inputs.ts';
import {
  adminOnly,
  clockOf,
  moderationOperatorOf,
} from './resolver-support.ts';

const productReaderOf = (context: GraphQLContext): AdminProductReader =>
  context.resolve<AdminProductReader>(MODERATION_TYPES.AdminProductReader);

const ratingReaderOf = (context: GraphQLContext): AdminRatingReader =>
  context.resolve<AdminRatingReader>(MODERATION_TYPES.AdminRatingReader);

const productModerationOf = (
  context: GraphQLContext,
): ProductModerationService =>
  context.resolve<ProductModerationService>(
    MODERATION_TYPES.ProductModerationService,
  );

async function productCommandOf(
  context: GraphQLContext,
  { id, reason }: { readonly id: string; readonly reason: string },
): Promise<ModerationCommand> {
  const operator = await moderationOperatorOf(context, 'moderator');
  return { targetId: id, reason, operator, at: clockOf(context).now() };
}

// プロダクトの一覧・詳細・カテゴリの選択肢・評価の一覧は閲覧のみ以上、非公開化と復元はモデレーター以上に許す。各リゾルバはadminOnlyで包み、入力の検証より前に管理者側以外の呼び出しを拒否する
export const productResolvers = {
  Query: {
    adminProducts: adminOnly(
      withValidatedArgs(
        ADMIN_PRODUCTS_ARGS,
        async (_parent: unknown, { filter, first, after }, context) => {
          await moderationOperatorOf(context, 'viewer');
          const page = await productReaderOf(context).list({
            filter,
            first,
            ...(after !== undefined && { after }),
            now: clockOf(context).now(),
          });
          return toConnectionResult(
            page.products,
            page.nextCursor,
            toAdminProduct,
          );
        },
      ),
    ),
    adminProduct: adminOnly(
      withValidatedArgs(
        ADMIN_PRODUCT_ARGS,
        async (_parent: unknown, { id }, context) => {
          await moderationOperatorOf(context, 'viewer');
          const detail = await productReaderOf(context).detail({
            productId: id,
            now: clockOf(context).now(),
          });
          return detail === null ? null : toAdminProductDetail(detail);
        },
      ),
    ),
    adminModerationCategoryOptions: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await moderationOperatorOf(context, 'viewer');
        const categories = await productReaderOf(context).categories();
        return categories.map(({ id, name }) => ({ id, name }));
      },
    ),
    adminProductRatings: adminOnly(
      withValidatedArgs(
        ADMIN_PRODUCT_RATINGS_ARGS,
        async (_parent: unknown, { productId, first, after }, context) => {
          await moderationOperatorOf(context, 'viewer');
          return toAdminRatingConnection(
            await ratingReaderOf(context).list({
              filter: { productId },
              first,
              ...(after !== undefined && { after }),
            }),
          );
        },
      ),
    ),
  },
  Mutation: {
    hideProduct: adminOnly(
      withValidatedArgs(
        PRODUCT_MODERATION_ARGS,
        async (_parent: unknown, args, context) => {
          const { changed } = await productModerationOf(context).hide(
            await productCommandOf(context, args),
          );
          return { changed };
        },
      ),
    ),
    unhideProduct: adminOnly(
      withValidatedArgs(
        PRODUCT_MODERATION_ARGS,
        async (_parent: unknown, args, context) => {
          const { changed } = await productModerationOf(context).unhide(
            await productCommandOf(context, args),
          );
          return { changed };
        },
      ),
    ),
  },
} satisfies Resolvers;
