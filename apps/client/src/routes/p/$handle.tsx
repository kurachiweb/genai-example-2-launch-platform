import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound } from '@tanstack/react-router';

import { NotFoundPage } from '../../components/pages/not-found-page.tsx';
import { ProductPage } from '../../components/product-page/product-page.tsx';
import { ProductPageError } from '../../components/product-page/product-page-error.tsx';
import { ProductPageSkeleton } from '../../components/product-page/product-page-skeleton.tsx';
import { PRODUCT_PAGE_SECTIONS } from '../../composition/product-page-sections.ts';
import {
  loadProductPage,
  productPageQueryOptions,
  toProductPageView,
} from '../../graphql/product-page.ts';
import { buildProductPageHead } from '../../head/page-heads.ts';

export const Route = createFileRoute('/p/$handle')({
  loader: loadProductPage,
  head: ({ loaderData }) => buildProductPageHead(loaderData),
  pendingComponent: ProductPageSkeleton,
  errorComponent: ProductPageError,
  // 表示中の取り直しで部品が投げた404も、loaderの404と同じ画面にする
  notFoundComponent: NotFoundPage,
  component: ProductPageRoute,
});

// 表示中の取り直しでプロダクトを表示できなくなった(非公開化・ハンドルの変更など)ときは、最初の表示と同じ404にする。
// プロダクトごとに切り替えの状態と区画の申告を作り直すため、別のプロダクトへの遷移ではページを作り直す
function ProductPageRoute() {
  const { handle } = Route.useParams();
  const { viewer } = Route.useRouteContext();
  const { data: view } = useSuspenseQuery({
    ...productPageQueryOptions(viewer, handle),
    select: toProductPageView,
  });
  if (view === undefined) {
    throw notFound();
  }
  return (
    <ProductPage
      key={view.id}
      sections={PRODUCT_PAGE_SECTIONS}
      page={view}
      viewer={viewer}
    />
  );
}
