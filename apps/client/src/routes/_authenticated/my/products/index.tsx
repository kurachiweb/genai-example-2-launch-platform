import { createFileRoute } from '@tanstack/react-router';

import { MY_PRODUCTS_PAGE_TITLE } from '../../../../components/product/my-product-messages.ts';
import { MyProductListPage } from '../../../../components/product/my-product-list-page.tsx';
import { MY_PRODUCT_SECTIONS } from '../../../../composition/my-product-sections.ts';
import { loadMyProducts } from '../../../../graphql/my-products.ts';
import { buildSitePageHead } from '../../../../head/page-heads.ts';

// 本人だけが読むページのため、検索の索引の対象外にする
export const Route = createFileRoute('/_authenticated/my/products/')({
  loader: loadMyProducts,
  head: () =>
    buildSitePageHead({ title: MY_PRODUCTS_PAGE_TITLE, noIndex: true }),
  component: MyProductsRoute,
});

function MyProductsRoute() {
  const { viewer } = Route.useRouteContext();
  return <MyProductListPage viewer={viewer} sections={MY_PRODUCT_SECTIONS} />;
}
