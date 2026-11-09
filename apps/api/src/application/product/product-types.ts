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

const ProductSaveHooks: unique symbol = Symbol.for('product.ProductSaveHooks');

const ProductStore: unique symbol = Symbol.for('product.ProductStore');

const ProductRegistration: unique symbol = Symbol.for(
  'product.ProductRegistration',
);

const ProductEditor: unique symbol = Symbol.for('product.ProductEditor');

const ProductDescriptionEditor: unique symbol = Symbol.for(
  'product.ProductDescriptionEditor',
);

const MyProductsReader: unique symbol = Symbol.for('product.MyProductsReader');

const ProductHandleAvailabilityChecker: unique symbol = Symbol.for(
  'product.ProductHandleAvailabilityChecker',
);

const ProductLifecycleCommitter: unique symbol = Symbol.for(
  'product.ProductLifecycleCommitter',
);

const ProductDeletion: unique symbol = Symbol.for('product.ProductDeletion');

const ProductVisibilityControl: unique symbol = Symbol.for(
  'product.ProductVisibilityControl',
);

const ProductWithdrawalSyncHandler: unique symbol = Symbol.for(
  'product.ProductWithdrawalSyncHandler',
);

const LaunchCancellationSyncHandler: unique symbol = Symbol.for(
  'product.LaunchCancellationSyncHandler',
);

export const PRODUCT_TYPES = Object.freeze({
  ProductStateEvaluator,
  RelaunchConditionSources,
  ProductLockSources,
  LaunchSummarySources,
  ProductSaveHooks,
  ProductStore,
  ProductRegistration,
  ProductEditor,
  ProductDescriptionEditor,
  MyProductsReader,
  ProductHandleAvailabilityChecker,
  ProductLifecycleCommitter,
  ProductDeletion,
  ProductVisibilityControl,
  ProductWithdrawalSyncHandler,
  LaunchCancellationSyncHandler,
});
