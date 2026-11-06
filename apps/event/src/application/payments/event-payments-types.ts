// backend-lib/core/paymentsのPAYMENTS_TYPESも同じpayments.の接頭辞を使うため、メンバーの名前を重ねない
const StripeWebhookReceiver: unique symbol = Symbol.for(
  'payments.StripeWebhookReceiver',
);

const RefundPaymentHandler: unique symbol = Symbol.for(
  'payments.RefundPaymentHandler',
);

const CustomerErasureHandler: unique symbol = Symbol.for(
  'payments.CustomerErasureHandler',
);

const OpenCheckoutExpiryHandler: unique symbol = Symbol.for(
  'payments.OpenCheckoutExpiryHandler',
);

const PaymentAccountDataEraser: unique symbol = Symbol.for(
  'payments.PaymentAccountDataEraser',
);

export const EVENT_PAYMENTS_TYPES = Object.freeze({
  StripeWebhookReceiver,
  RefundPaymentHandler,
  CustomerErasureHandler,
  OpenCheckoutExpiryHandler,
  PaymentAccountDataEraser,
});
