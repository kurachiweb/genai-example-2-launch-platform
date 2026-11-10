import type { Resolvers } from '../../generated/resolvers-types.ts';
import { productCategoryOf, productImageOf } from '../product/product-views.ts';
import { userSummaryLoader } from '../profile/user-summary.ts';

// 一覧の各行で要求されるため、カテゴリ・画像・投稿者は一括読み込みで1回の照会にまとめる。表示できなくなった投稿者はnullにする
export const directoryViewResolvers = {
  DirectoryItem: {
    category: (item, _args, context) =>
      productCategoryOf(item.categoryId, context),
    logo: (item, _args, context) => productImageOf(item.logoFileId, context),
    owner: (item, _args, context) =>
      context.loaders.get(userSummaryLoader).load(item.ownerUserId),
  },
} satisfies Resolvers;
