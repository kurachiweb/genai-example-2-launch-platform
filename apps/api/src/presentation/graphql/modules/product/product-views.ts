import type { ProductCategoryService } from '../../../../application/product/product-category-service.ts';
import { PRODUCT_TYPES } from '../../../../application/product/product-types.ts';
import type { Resolvers } from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { defineLoader } from '../../loaders.ts';
import { mediaFileLoader } from '../media/loaders.ts';
import { type MediaImageModel, toMediaImage } from '../media/mappers.ts';
import { type ProductCategoryModel, toProductCategory } from './mappers.ts';

// カテゴリは件数が少なく一覧を1回で読める。プロダクトが紐付くカテゴリは削除できないため、見つからないのはデータの不整合である
export const productCategoryLoader = defineLoader<string, ProductCategoryModel>(
  {
    name: 'productCategory',
    batch: async (ids, scope) => {
      const categories = await scope
        .resolve<ProductCategoryService>(PRODUCT_TYPES.ProductCategoryService)
        .list();
      const byId = new Map(
        categories.map((category) => [
          category.id,
          toProductCategory(category),
        ]),
      );
      return ids.map(
        (id) =>
          byId.get(id) ?? new Error(`プロダクトカテゴリ${id}が見つかりません`),
      );
    },
  },
);

// 一覧の各行で要求されるため、画像の記録は一括読み込みで1回の照会にまとめる。記録が無い画像はnullにする
export async function productImageOf(
  fileId: string,
  context: GraphQLContext,
): Promise<MediaImageModel | null> {
  const file = await context.loaders.get(mediaFileLoader).load(fileId);
  return file === null ? null : toMediaImage(file);
}

export const productCategoryOf = (
  categoryId: string,
  context: GraphQLContext,
): Promise<ProductCategoryModel> =>
  context.loaders.get(productCategoryLoader).load(categoryId);

export const productViewResolvers = {
  MyProduct: {
    logo: (product, _args, context) =>
      productImageOf(product.logoFileId, context),
  },
  ProductScreenshot: {
    image: (screenshot, _args, context) =>
      productImageOf(screenshot.fileId, context),
    byteSize: async (screenshot, _args, context) => {
      const file = await context.loaders
        .get(mediaFileLoader)
        .load(screenshot.fileId);
      return file?.byteSize ?? 0;
    },
  },
  LaunchHistoryProduct: {
    category: (product, _args, context) =>
      productCategoryOf(product.categoryId, context),
    logo: (product, _args, context) =>
      productImageOf(product.logoFileId, context),
  },
  MyProductResult: {
    __resolveType: (result: object) =>
      'plan' in result ? 'MyProduct' : 'MyProductRedirect',
  },
} satisfies Resolvers;
