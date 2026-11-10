import type {
  ProductLaunchSection,
  ProductOwnerAction,
  ProductPageSection,
} from '../components/product-page/product-page-section-types.ts';

// プロダクト詳細ページの置き場所ごとに並べる区画の登録箇所。各specが自分の区画を追記する
export const PRODUCT_PAGE_SECTIONS: readonly ProductPageSection[] =
  Object.freeze([]);

// マッチ履歴の各ローンチのブロックに並べる区画の登録箇所。各specが自分の区画を追記する
export const PRODUCT_LAUNCH_SECTIONS: readonly ProductLaunchSection[] =
  Object.freeze([]);

// 投稿者本人向けの操作に並べる操作の登録箇所。各specが自分の操作を追記する
export const PRODUCT_OWNER_ACTIONS: readonly ProductOwnerAction[] =
  Object.freeze([]);
