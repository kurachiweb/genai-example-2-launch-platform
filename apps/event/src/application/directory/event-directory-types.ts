// APIサーバーとbackend-lib/core/directoryの識別子がdirectory.の接頭辞を使うため、イベントサーバーの識別子はdirectory.event.で分ける
const QualifierListingHandler: unique symbol = Symbol.for(
  'directory.event.QualifierListingHandler',
);
const ProductIndexRestoreHandler: unique symbol = Symbol.for(
  'directory.event.ProductIndexRestoreHandler',
);
const EntryErasureHandler: unique symbol = Symbol.for(
  'directory.event.EntryErasureHandler',
);
const AccountIndexRestoreHandler: unique symbol = Symbol.for(
  'directory.event.AccountIndexRestoreHandler',
);
const ProductIndexPendingMarker: unique symbol = Symbol.for(
  'directory.event.ProductIndexPendingMarker',
);

export const EVENT_DIRECTORY_TYPES = Object.freeze({
  QualifierListingHandler,
  ProductIndexRestoreHandler,
  EntryErasureHandler,
  AccountIndexRestoreHandler,
  ProductIndexPendingMarker,
});
