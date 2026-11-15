const ProductDirectory: unique symbol = Symbol.for('product.ProductDirectory');
const ProductCategoryDirectory: unique symbol = Symbol.for(
  'product.ProductCategoryDirectory',
);
const ScheduledLaunchDirectory: unique symbol = Symbol.for(
  'product.ScheduledLaunchDirectory',
);
const LaunchOutcomeRecorder: unique symbol = Symbol.for(
  'product.LaunchOutcomeRecorder',
);
const ProductExport: unique symbol = Symbol.for('product.ProductExport');
const LaunchExport: unique symbol = Symbol.for('product.LaunchExport');
const ProductLifecycleStore: unique symbol = Symbol.for(
  'product.ProductLifecycleStore',
);
const AdminProductDirectory: unique symbol = Symbol.for(
  'product.AdminProductDirectory',
);

export const PRODUCT_PLATFORM_TYPES = Object.freeze({
  ProductDirectory,
  ProductCategoryDirectory,
  ScheduledLaunchDirectory,
  LaunchOutcomeRecorder,
  ProductExport,
  LaunchExport,
  ProductLifecycleStore,
  AdminProductDirectory,
});
