// APIサーバーとbackend-lib/core/reportingの識別子がreporting.api.とreporting.の接頭辞を使うため、イベントサーバーの識別子はreporting.event.で分ける
const UserReportErasureHandler: unique symbol = Symbol.for(
  'reporting.event.UserReportErasureHandler',
);
const ProductReportErasureHandler: unique symbol = Symbol.for(
  'reporting.event.ProductReportErasureHandler',
);

export const EVENT_REPORTING_TYPES = Object.freeze({
  UserReportErasureHandler,
  ProductReportErasureHandler,
});
