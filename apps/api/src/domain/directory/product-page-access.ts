import type { ProductHandleResolution } from '../../../lib/core/product/ports.ts';

export type ProductPageAccess =
  | {
      readonly kind: 'render';
      readonly productId: string;
      readonly ownerView: boolean;
      readonly unlisted: boolean;
    }
  | { readonly kind: 'redirect'; readonly handle: string }
  | { readonly kind: 'not-found' };

const NOT_FOUND: ProductPageAccess = Object.freeze({ kind: 'not-found' });

// 存在しない・可視でない・未掲載を区別せず同じ404にし、表示できないプロダクトの現在のハンドルを転送で漏らさない
export function decideProductPageAccess(input: {
  readonly resolution: ProductHandleResolution;
  readonly viewerUserId: string | undefined;
}): ProductPageAccess {
  const { resolution, viewerUserId } = input;
  if (resolution.kind === 'none' || !resolution.product.visible) {
    return NOT_FOUND;
  }
  const { product } = resolution;
  const ownerView =
    viewerUserId !== undefined && viewerUserId === product.ownerUserId;
  if (!product.listed && !ownerView) {
    return NOT_FOUND;
  }
  if (resolution.kind === 'previous') {
    return { kind: 'redirect', handle: product.handle };
  }
  return {
    kind: 'render',
    productId: product.productId,
    ownerView,
    unlisted: !product.listed,
  };
}
