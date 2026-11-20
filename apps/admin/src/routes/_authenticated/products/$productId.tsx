import { createFileRoute } from '@tanstack/react-router';

import { PRODUCT_DETAIL_COPY } from '../../../components/moderation/shared/moderation-messages.ts';
import { ProductDetailPage } from '../../../components/pages/product-detail-page.tsx';
import { ProductNotFoundPage } from '../../../components/pages/product-not-found-page.tsx';
import { loadAdminModerationProductPage } from '../../../graphql/admin-moderation-products.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/products/$productId')({
  loader: loadAdminModerationProductPage,
  head: () => buildAdminPageHead({ title: PRODUCT_DETAIL_COPY.pageTitle }),
  component: ProductDetailPage,
  // 見つからないプロダクトはサイト全体の存在しないページではなく、一覧へ戻る導線を持つプロダクトの不在の表示にする
  notFoundComponent: () => <ProductNotFoundPage />,
});
