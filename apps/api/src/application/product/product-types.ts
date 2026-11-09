// backend-lib/core/productのPRODUCT_PLATFORM_TYPESも同じproduct.の接頭辞を使うため、メンバーの名前を重ねない
const ProductStateEvaluator: unique symbol = Symbol.for(
  'product.ProductStateEvaluator',
);

const RelaunchConditionSources: unique symbol = Symbol.for(
  'product.RelaunchConditionSources',
);

const ProductLockSources: unique symbol = Symbol.for(
  'product.ProductLockSources',
);

const LaunchSummarySources: unique symbol = Symbol.for(
  'product.LaunchSummarySources',
);

export const PRODUCT_TYPES = Object.freeze({
  ProductStateEvaluator,
  RelaunchConditionSources,
  ProductLockSources,
  LaunchSummarySources,
});
