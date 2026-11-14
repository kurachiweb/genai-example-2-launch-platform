import { createFileRoute } from '@tanstack/react-router';

import { editProductLabel } from '../../../../../components/product/my-product-messages.ts';
import { ProductEditPage } from '../../../../../components/product/product-edit-page.tsx';
import { MY_PRODUCT_SECTIONS } from '../../../../../composition/my-product-sections.ts';
import { PRODUCT_DELETE_NOTICES } from '../../../../../composition/product-delete-notices.ts';
import { loadMyProductEdit } from '../../../../../graphql/my-products.ts';
import { buildSitePageHead } from '../../../../../head/page-heads.ts';

// 本人だけが読むページのため、検索の索引の対象外にする
export const Route = createFileRoute(
  '/_authenticated/my/products/$handle/edit',
)({
  loader: loadMyProductEdit,
  head: ({ loaderData }) =>
    buildSitePageHead({
      title: editProductLabel(loaderData?.name ?? ''),
      noIndex: true,
    }),
  component: EditProductRoute,
});

// 別のプロダクトの編集画面へ移った時に前のプロダクトのフォームを残さないよう、ハンドルごとに画面を作り直す
function EditProductRoute() {
  const { viewer } = Route.useRouteContext();
  const { handle } = Route.useParams();
  const { name } = Route.useLoaderData();
  return (
    <ProductEditPage
      key={handle}
      viewer={viewer}
      handle={handle}
      productName={name}
      sections={MY_PRODUCT_SECTIONS}
      deleteNotices={PRODUCT_DELETE_NOTICES}
    />
  );
}
