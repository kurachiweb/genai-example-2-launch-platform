import { checkHandleFormat } from '../../../common-lib/handles/handle-rules.ts';
import { PRODUCT_HANDLE_RULE } from '../../../common-lib/product/product-input-rules.ts';
import type { CurrentUser } from '../../../lib/core/identity/account-guard.ts';
import type {
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import {
  decideProductPageAccess,
  type ProductPageAccess,
} from '../../domain/directory/product-page-access.ts';

export type ProductPageResolution =
  | {
      readonly kind: 'render';
      readonly product: ProductSummaryRecord;
      readonly ownerView: boolean;
      readonly unlisted: boolean;
    }
  | Exclude<ProductPageAccess, { readonly kind: 'render' }>;

const NOT_FOUND: ProductPageResolution = Object.freeze({ kind: 'not-found' });

// 形式に合わないハンドルは照会をせずに、存在しない場合と同じ結果にする
export async function resolveProductPage(
  products: ProductDirectory,
  handle: string,
  viewer: CurrentUser | undefined,
): Promise<ProductPageResolution> {
  if (checkHandleFormat(handle, PRODUCT_HANDLE_RULE) !== 'ok') {
    return NOT_FOUND;
  }
  const resolution = await products.resolveHandle(handle);
  if (resolution.kind === 'none') {
    return NOT_FOUND;
  }
  const access = decideProductPageAccess({
    resolution,
    viewerUserId: viewer?.user.id,
  });
  return access.kind === 'render'
    ? {
        kind: 'render',
        product: resolution.product,
        ownerView: access.ownerView,
        unlisted: access.unlisted,
      }
    : access;
}
