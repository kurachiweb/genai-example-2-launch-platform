import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, Link, notFound } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { ADMIN_PRODUCT_DETAIL_SECTIONS } from '../../composition/admin-product-detail-sections.ts';
import {
  adminModerationProductQueryOptions,
  toAdminModerationProductDetail,
} from '../../graphql/admin-moderation-products.ts';
import { AdminProductDetailSectionsView } from '../moderation/products/admin-product-detail-sections-view.tsx';
import { ProductDetailView } from '../moderation/products/product-detail-view.tsx';
import { PRODUCT_DETAIL_COPY } from '../moderation/shared/moderation-messages.ts';

const routeApi = getRouteApi('/_authenticated/products/$productId');

export function ProductDetailPage() {
  const { productId } = routeApi.useParams();
  const { data: detail } = useSuspenseQuery({
    ...adminModerationProductQueryOptions(productId),
    select: toAdminModerationProductDetail,
  });
  // loaderが確かめたプロダクトが取り直しで消えるのは表示中の論理削除の後で、見つからないプロダクトとして扱う
  if (detail === null) {
    throw notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <div className="flex flex-col gap-3">
        <AdminPageHeader title={detail.product.name} />
        <Link
          to="/products"
          className="inline-flex items-center gap-1 self-start text-sm text-primary underline-offset-2 hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          {PRODUCT_DETAIL_COPY.backToList}
        </Link>
      </div>
      <ProductDetailView detail={detail} />
      <AdminProductDetailSectionsView
        sections={ADMIN_PRODUCT_DETAIL_SECTIONS}
        product={{
          productId: detail.product.id,
          ownerUserId: detail.product.owner?.id ?? null,
        }}
      />
    </div>
  );
}
