// APIサーバーとbackend-lib/core/moderationの識別子がmoderation.api.とmoderation.の接頭辞を使うため、イベントサーバーの識別子はmoderation.event.で分ける
const AccountRecordErasureHandler: unique symbol = Symbol.for(
  'moderation.event.AccountRecordErasureHandler',
);
const ProductRecordErasureHandler: unique symbol = Symbol.for(
  'moderation.event.ProductRecordErasureHandler',
);

export const EVENT_MODERATION_TYPES = Object.freeze({
  AccountRecordErasureHandler,
  ProductRecordErasureHandler,
});
