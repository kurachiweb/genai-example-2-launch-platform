import type { ProductCategoryService } from '../../../../application/product/product-category-service.ts';
import { PRODUCT_TYPES } from '../../../../application/product/product-types.ts';
import { requireAdmin } from '../../admin-guard.ts';
import { withInputPath } from '../../field-paths.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { INPUT_ARGUMENT } from './errors.ts';
import {
  CREATE_PRODUCT_CATEGORY_ARGS,
  DELETE_PRODUCT_CATEGORY_ARGS,
  UPDATE_PRODUCT_CATEGORY_ARGS,
} from './inputs.ts';
import { toProductCategory } from './mappers.ts';
import { adminOnly } from './resolver-support.ts';

const serviceOf = (context: GraphQLContext): ProductCategoryService =>
  context.resolve<ProductCategoryService>(PRODUCT_TYPES.ProductCategoryService);

const listCategories = async (context: GraphQLContext) =>
  (await serviceOf(context).list()).map(toProductCategory);

// 一覧は利用者側の登録・編集の画面と管理画面の選択肢に同じ順で返すため、どちらの呼び出し元にもログインを求めない。
// 追加・変更・削除はモデレーター以上に限り、名前とハンドルの違反と重複はユースケースが入力からの相対の欄で返す
export const categoryResolvers = {
  Query: {
    productCategories: (
      _parent: unknown,
      _args: unknown,
      context: GraphQLContext,
    ) => listCategories(context),
    adminProductCategories: adminOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
        await requireAdmin(context, 'viewer');
        return listCategories(context);
      },
    ),
  },
  Mutation: {
    createProductCategory: adminOnly(
      withValidatedArgs(
        CREATE_PRODUCT_CATEGORY_ARGS,
        async (_parent: unknown, { input, reason }, context) => {
          const current = await requireAdmin(context, 'moderator');
          return toProductCategory(
            await withInputPath(INPUT_ARGUMENT, () =>
              serviceOf(context).create(current, input, reason),
            ),
          );
        },
      ),
    ),
    updateProductCategory: adminOnly(
      withValidatedArgs(
        UPDATE_PRODUCT_CATEGORY_ARGS,
        async (_parent: unknown, { id, input, reason }, context) => {
          const current = await requireAdmin(context, 'moderator');
          return toProductCategory(
            await withInputPath(INPUT_ARGUMENT, () =>
              serviceOf(context).update(current, id, input, reason),
            ),
          );
        },
      ),
    ),
    deleteProductCategory: adminOnly(
      withValidatedArgs(
        DELETE_PRODUCT_CATEGORY_ARGS,
        async (_parent: unknown, { id, reason }, context) => {
          const current = await requireAdmin(context, 'moderator');
          await serviceOf(context).delete(current, id, reason);
          return true;
        },
      ),
    ),
  },
} satisfies Resolvers;
