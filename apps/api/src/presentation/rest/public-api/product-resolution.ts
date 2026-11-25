import type { Context } from 'hono';
import { routePath } from 'hono/route';

import type {
  ProductDirectory,
  ProductSummaryRecord,
} from '../../../../lib/core/product/ports.ts';
import { resolveProductPage } from '../../../application/directory/product-page-resolution.ts';
import { currentHandleLocation } from './current-handle-location.ts';

export type PublicProductResolution =
  | { readonly kind: 'current'; readonly product: ProductSummaryRecord }
  | { readonly kind: 'redirect'; readonly handle: string }
  | { readonly kind: 'not-found' };

const NOT_FOUND: PublicProductResolution = Object.freeze({
  kind: 'not-found',
});

const FOUND_STATUS = 302;

// 公開APIはキーの持ち主も閲覧者とせず、未ログインの閲覧者と同じ公開範囲で解決する。形式違反・不在・公開範囲外を区別しない
export async function resolvePublicProduct(
  products: ProductDirectory,
  handle: string,
): Promise<PublicProductResolution> {
  const resolution = await resolveProductPage(products, handle, undefined);
  switch (resolution.kind) {
    case 'render': {
      return { kind: 'current', product: resolution.product };
    }
    case 'redirect': {
      return { kind: 'redirect', handle: resolution.handle };
    }
    case 'not-found': {
      return NOT_FOUND;
    }
  }
}

// 保有者が次にハンドルを変えると転送先が変わるため、永続的な転送にしない
export function redirectToCurrentHandle(c: Context, handle: string): Response {
  return c.redirect(
    currentHandleLocation({
      requestUrl: c.req.url,
      routePath: routePath(c),
      handle,
    }),
    FOUND_STATUS,
  );
}
