// APIサーバーとbackend-lib/core/engagementの識別子がengagement.の接頭辞を使うため、イベントサーバーの識別子はengagement.event.で分ける
const AccountErasureHandler: unique symbol = Symbol.for(
  'engagement.event.AccountErasureHandler',
);
const ProductErasureHandler: unique symbol = Symbol.for(
  'engagement.event.ProductErasureHandler',
);

export const EVENT_ENGAGEMENT_TYPES = Object.freeze({
  AccountErasureHandler,
  ProductErasureHandler,
});
