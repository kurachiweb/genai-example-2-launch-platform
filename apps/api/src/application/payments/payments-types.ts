// backend-lib/core/paymentsのPAYMENTS_TYPESも同じpayments.の接頭辞を使うため、メンバーの名前を重ねない
const CheckoutStartLimits: unique symbol = Symbol.for(
  'payments.CheckoutStartLimits',
);

const CheckoutPurchaseWriter: unique symbol = Symbol.for(
  'payments.CheckoutPurchaseWriter',
);

const PurchaseOfferPolicyResolver: unique symbol = Symbol.for(
  'payments.PurchaseOfferPolicyResolver',
);

const PaymentsJobIncidentReporter: unique symbol = Symbol.for(
  'payments.PaymentsJobIncidentReporter',
);

const CheckoutStarter: unique symbol = Symbol.for('payments.CheckoutStarter');

const CheckoutReader: unique symbol = Symbol.for('payments.CheckoutReader');

const CheckoutConsentRecorder: unique symbol = Symbol.for(
  'payments.CheckoutConsentRecorder',
);

const CheckoutReturnConfirmer: unique symbol = Symbol.for(
  'payments.CheckoutReturnConfirmer',
);

const PaymentHistoryReader: unique symbol = Symbol.for(
  'payments.PaymentHistoryReader',
);

const CheckoutReconciliationJob: unique symbol = Symbol.for(
  'payments.CheckoutReconciliationJob',
);

const PendingCheckoutSweepJob: unique symbol = Symbol.for(
  'payments.PendingCheckoutSweepJob',
);

const PaymentHistoryRetentionJob: unique symbol = Symbol.for(
  'payments.PaymentHistoryRetentionJob',
);

export const API_PAYMENTS_TYPES = Object.freeze({
  CheckoutStartLimits,
  CheckoutPurchaseWriter,
  PurchaseOfferPolicyResolver,
  PaymentsJobIncidentReporter,
  CheckoutStarter,
  CheckoutReader,
  CheckoutConsentRecorder,
  CheckoutReturnConfirmer,
  PaymentHistoryReader,
  CheckoutReconciliationJob,
  PendingCheckoutSweepJob,
  PaymentHistoryRetentionJob,
});
