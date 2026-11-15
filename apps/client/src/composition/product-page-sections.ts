import { matchHistorySectionOf } from '../components/product-page/match-history-section.tsx';
import { ownerCardSectionOf } from '../components/product-page/owner-card.tsx';
import { ProductDescriptionSection } from '../components/product-page/product-description-section.tsx';
import type {
  ProductLaunchSection,
  ProductOwnerAction,
  ProductPageSection,
} from '../components/product-page/product-page-section-types.ts';
import { ScreenshotGallerySection } from '../components/product-page/screenshot-gallery-section.tsx';

// マッチ履歴の各ローンチのブロックに並べる区画の登録箇所。各specが自分の区画を追記する
export const PRODUCT_LAUNCH_SECTIONS: readonly ProductLaunchSection[] =
  Object.freeze([]);

// 投稿者本人向けの操作に並べる操作の登録箇所。各specが自分の操作を追記する
export const PRODUCT_OWNER_ACTIONS: readonly ProductOwnerAction[] =
  Object.freeze([]);

// プロダクト詳細ページの置き場所ごとに並べる区画の登録箇所。各specが自分の区画を追記する。
// 上の2つの登録口を渡して区画を作るため、この登録口はそれらの後に置く
export const PRODUCT_PAGE_SECTIONS: readonly ProductPageSection[] =
  Object.freeze([
    {
      id: 'directory-discovery.screenshots',
      placement: 'main',
      order: 20,
      component: ScreenshotGallerySection,
    },
    {
      id: 'directory-discovery.description',
      placement: 'main',
      order: 30,
      component: ProductDescriptionSection,
    },
    {
      id: 'directory-discovery.match-history',
      placement: 'main',
      order: 40,
      component: matchHistorySectionOf(PRODUCT_LAUNCH_SECTIONS),
    },
    {
      id: 'directory-discovery.owner',
      placement: 'aside',
      order: 10,
      component: ownerCardSectionOf(PRODUCT_OWNER_ACTIONS),
    },
  ]);
