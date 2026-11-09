// APIサーバーのPRODUCT_TYPESとbackend-lib/core/productの識別子がproduct.の接頭辞を使うため、イベントサーバーの識別子はproduct.event.で分ける
const ProductPurgeStore: unique symbol = Symbol.for(
  'product.event.ProductPurgeStore',
);
const ProductLifecycleRunner: unique symbol = Symbol.for(
  'product.event.ProductLifecycleRunner',
);
const ProductImageQuarantineHandler: unique symbol = Symbol.for(
  'product.event.ProductImageQuarantineHandler',
);
const ProductImageErasureHandler: unique symbol = Symbol.for(
  'product.event.ProductImageErasureHandler',
);
const UserProductErasureHandler: unique symbol = Symbol.for(
  'product.event.UserProductErasureHandler',
);

export const EVENT_PRODUCT_TYPES = Object.freeze({
  ProductPurgeStore,
  ProductLifecycleRunner,
  ProductImageQuarantineHandler,
  ProductImageErasureHandler,
  UserProductErasureHandler,
});
