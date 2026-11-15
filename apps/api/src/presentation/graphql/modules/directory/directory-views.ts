import type { Resolvers } from '../../generated/resolvers-types.ts';
import { loadMatchView } from '../match/match-views.ts';
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
  // 照会の後に投稿者が退会・停止した競合では投稿者がnullになり、部分的なページを出さないよう取得のエラーにする
  ProductPage: {
    category: (page, _args, context) =>
      productCategoryOf(page.categoryId, context),
    logo: (page, _args, context) => productImageOf(page.logoFileId, context),
    owner: async (page, _args, context) => {
      const owner = await context.loaders
        .get(userSummaryLoader)
        .load(page.ownerUserId);
      if (owner === null) {
        throw new Error(
          `プロダクト${page.id}の投稿者を表示できません: ${page.ownerUserId}`,
        );
      }
      return owner;
    },
  },
  ProductPageScreenshot: {
    image: (screenshot, _args, context) =>
      productImageOf(screenshot.fileId, context),
  },
  ProductPageOpponent: {
    logo: (opponent, _args, context) =>
      opponent.logoFileId === null
        ? null
        : productImageOf(opponent.logoFileId, context),
  },
  // 閲覧者のUpvoteと制限はmatch-engineが処理単位のセッションで解決する
  ProductLiveMatch: {
    match: (live, _args, context) =>
      live.matchId === null ? null : loadMatchView(context, live.matchId),
  },
} satisfies Resolvers;
