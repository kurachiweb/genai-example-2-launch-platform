// APIサーバーとbackend-lib/core/directoryの識別子がdirectory.の接頭辞を使うため、イベントサーバーの識別子はdirectory.event.で分ける
const QualifierListingHandler: unique symbol = Symbol.for(
  'directory.event.QualifierListingHandler',
);
const ProductIndexPendingMarker: unique symbol = Symbol.for(
  'directory.event.ProductIndexPendingMarker',
);

export const EVENT_DIRECTORY_TYPES = Object.freeze({
  QualifierListingHandler,
  ProductIndexPendingMarker,
});
