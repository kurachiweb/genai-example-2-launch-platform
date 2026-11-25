import type { MyProductsPage } from '../../../../application/product/my-products-reader.ts';
import type { MyProductView } from '../../../../application/product/ports.ts';
import type { MyProduct, MyProductList } from '../schemas/my-products.ts';
import { productPageUrl } from './common-mappers.ts';

// 上流のビューは最新のローンチ日を持たないため、並びの基準は応答に載せない
export function toMyProduct(
  view: MyProductView,
  siteOrigin: string,
): MyProduct {
  return {
    id: view.productId,
    handle: view.handle,
    name: view.name,
    description_markdown: view.descriptionMarkdown,
    listed: view.listed,
    hidden: view.hidden,
    page_url: productPageUrl(siteOrigin, view.handle),
  };
}

export function toMyProductListPage(
  page: MyProductsPage,
  siteOrigin: string,
): MyProductList {
  return {
    data: page.nodes.map((view) => toMyProduct(view, siteOrigin)),
    meta: { has_next: page.hasNextPage, next_cursor: page.endCursor },
  };
}
