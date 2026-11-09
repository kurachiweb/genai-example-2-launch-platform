import { createFileRoute } from '@tanstack/react-router';

import { PRODUCT_REGISTER_PAGE_TITLE } from '../../../../components/product/product-form-messages.ts';
import { ProductRegistrationPage } from '../../../../components/product/product-registration-page.tsx';
import { loadProductRegistration } from '../../../../graphql/my-products.ts';
import { buildSitePageHead } from '../../../../head/page-heads.ts';

// 本人だけが読むページのため、検索の索引の対象外にする
export const Route = createFileRoute('/_authenticated/my/products/new')({
  loader: loadProductRegistration,
  head: () =>
    buildSitePageHead({ title: PRODUCT_REGISTER_PAGE_TITLE, noIndex: true }),
  component: NewProductRoute,
});

function NewProductRoute() {
  const { viewer } = Route.useRouteContext();
  return <ProductRegistrationPage viewer={viewer} />;
}
