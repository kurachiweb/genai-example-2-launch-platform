const StripeGateway: unique symbol = Symbol.for('payments.StripeGateway');
const StripeWebhookVerifier: unique symbol = Symbol.for(
  'payments.StripeWebhookVerifier',
);
const PurchaseKindRegistry: unique symbol = Symbol.for(
  'payments.PurchaseKindRegistry',
);
const PaymentReflector: unique symbol = Symbol.for('payments.PaymentReflector');
const OpenCheckoutExpirer: unique symbol = Symbol.for(
  'payments.OpenCheckoutExpirer',
);
const PaymentRefunds: unique symbol = Symbol.for('payments.PaymentRefunds');
const PurchaseNotifier: unique symbol = Symbol.for('payments.PurchaseNotifier');
const PriceCatalog: unique symbol = Symbol.for('payments.PriceCatalog');
const CustomerDirectory: unique symbol = Symbol.for(
  'payments.CustomerDirectory',
);
const PaymentHistoryExport: unique symbol = Symbol.for(
  'payments.PaymentHistoryExport',
);
const PaymentRevenueReport: unique symbol = Symbol.for(
  'payments.PaymentRevenueReport',
);
const PurchaseStore: unique symbol = Symbol.for('payments.PurchaseStore');
const PaymentRecordStore: unique symbol = Symbol.for(
  'payments.PaymentRecordStore',
);
const RefundStore: unique symbol = Symbol.for('payments.RefundStore');
const CustomerStore: unique symbol = Symbol.for('payments.CustomerStore');
const StripeObjectStore: unique symbol = Symbol.for(
  'payments.StripeObjectStore',
);
const PriceSnapshotStore: unique symbol = Symbol.for(
  'payments.PriceSnapshotStore',
);
const PurchaseStatements: unique symbol = Symbol.for(
  'payments.PurchaseStatements',
);
const PaymentRecordStatements: unique symbol = Symbol.for(
  'payments.PaymentRecordStatements',
);
const RefundStatements: unique symbol = Symbol.for('payments.RefundStatements');
const CustomerStatements: unique symbol = Symbol.for(
  'payments.CustomerStatements',
);
const StripeObjectStatements: unique symbol = Symbol.for(
  'payments.StripeObjectStatements',
);
const GuardedBatch: unique symbol = Symbol.for('payments.GuardedBatch');
const PaymentRefundStatements: unique symbol = Symbol.for(
  'payments.PaymentRefundStatements',
);
const PaymentOwnerResolver: unique symbol = Symbol.for(
  'payments.PaymentOwnerResolver',
);
const CheckoutSessionReflection: unique symbol = Symbol.for(
  'payments.CheckoutSessionReflection',
);
const SmokePurchaseOffer: unique symbol = Symbol.for(
  'payments.SmokePurchaseOffer',
);
const SmokePurchaseFulfillment: unique symbol = Symbol.for(
  'payments.SmokePurchaseFulfillment',
);

// 識別子は型を読み込まないため、workersとinfrastructureだけが受け取る契約(文を返す操作など)の識別子も同じオブジェクトに置く
export const PAYMENTS_TYPES = Object.freeze({
  StripeGateway,
  StripeWebhookVerifier,
  PurchaseKindRegistry,
  PaymentReflector,
  OpenCheckoutExpirer,
  PaymentRefunds,
  PurchaseNotifier,
  PriceCatalog,
  CustomerDirectory,
  PaymentHistoryExport,
  PaymentRevenueReport,
  PurchaseStore,
  PaymentRecordStore,
  RefundStore,
  CustomerStore,
  StripeObjectStore,
  PriceSnapshotStore,
  PurchaseStatements,
  PaymentRecordStatements,
  RefundStatements,
  CustomerStatements,
  StripeObjectStatements,
  GuardedBatch,
  PaymentRefundStatements,
  PaymentOwnerResolver,
  CheckoutSessionReflection,
  SmokePurchaseOffer,
  SmokePurchaseFulfillment,
});
