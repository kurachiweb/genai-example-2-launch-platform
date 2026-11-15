import type Stripe from 'stripe';

import type {
  StripeDisputeSnapshot,
  StripeInvoiceSnapshot,
  StripeInvoiceStatus,
  StripeRefundSnapshot,
  StripeRefundStatus,
  StripeSubscriptionSnapshot,
} from '../../core/payments/ports.ts';
import type { StripeSubscriptionStatus } from '../../core/payments/purchase-kind-contract.ts';

const INVOICE_STATUSES: readonly StripeInvoiceStatus[] = [
  'draft',
  'open',
  'paid',
  'uncollectible',
  'void',
];

const REFUND_STATUSES: readonly StripeRefundStatus[] = [
  'pending',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
];

const SUBSCRIPTION_STATUSES: readonly StripeSubscriptionStatus[] = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
];

export function includes<T extends string>(
  values: readonly T[],
  value: string | null,
): value is T {
  return (values as readonly (string | null)[]).includes(value);
}

export function idOf(
  value: string | { readonly id: string } | null,
): string | null {
  return typeof value === 'string' || value === null ? value : value.id;
}

export function unexpectedValue(
  object: string,
  field: string,
  value: string | null,
): Error {
  return new Error(
    `Stripeの${object}の${field}が想定外の値です: ${String(value)}`,
  );
}

function dateOf(seconds: number | null): Date | null {
  return seconds === null ? null : new Date(seconds * 1000);
}

// 請求の支払いを展開した請求から、既定の支払いのPaymentIntentを辿る
export function invoicePaymentIntentOf(
  invoice: string | Stripe.Invoice | null,
): string | Stripe.PaymentIntent | null {
  if (invoice === null || typeof invoice === 'string') {
    return null;
  }
  const payments = invoice.payments?.data ?? [];
  const payment =
    payments.find((candidate) => candidate.is_default) ?? payments[0];
  return payment?.payment.payment_intent ?? null;
}

// 定期課金の請求が確定した時点の定期課金のメタデータ。定期課金の請求でなければnull
export function subscriptionMetadataOf(
  invoice: Stripe.Invoice,
): Readonly<Record<string, string>> | null {
  const details = invoice.parent?.subscription_details;
  return details === null || details === undefined
    ? null
    : { ...details.metadata };
}

export function toInvoiceSnapshot(
  invoice: Stripe.Invoice,
): StripeInvoiceSnapshot {
  const { status } = invoice;
  if (!includes(INVOICE_STATUSES, status)) {
    throw unexpectedValue('請求', 'status', status);
  }
  return {
    id: invoice.id,
    status,
    amountPaid: invoice.amount_paid,
    amountDue: invoice.amount_due,
    currency: invoice.currency,
    paymentIntentId: idOf(invoicePaymentIntentOf(invoice)),
    subscriptionId: idOf(
      invoice.parent?.subscription_details?.subscription ?? null,
    ),
    subscriptionMetadata: subscriptionMetadataOf(invoice) ?? {},
  };
}

export function toRefundSnapshot(refund: Stripe.Refund): StripeRefundSnapshot {
  const { status } = refund;
  if (!includes(REFUND_STATUSES, status)) {
    throw unexpectedValue('返金', 'status', status);
  }
  return {
    id: refund.id,
    status,
    amount: refund.amount,
    currency: refund.currency,
    paymentIntentId: idOf(refund.payment_intent),
    failureReason: refund.failure_reason ?? null,
    metadata: { ...refund.metadata },
  };
}

// 不服申し立ての状態や今後加わる状態でも反映が止まらないよう、状態の値は検査しない
export function toDisputeSnapshot(
  dispute: Stripe.Dispute,
): StripeDisputeSnapshot {
  return {
    id: dispute.id,
    status: dispute.status,
    amount: dispute.amount,
    currency: dispute.currency,
    paymentIntentId: idOf(dispute.payment_intent),
    balanceTransactions: dispute.balance_transactions.map((transaction) => ({
      id: transaction.id,
      amount: transaction.amount,
    })),
  };
}

export function isEndedSubscription(
  subscription: Stripe.Subscription,
): boolean {
  return (
    subscription.status === 'canceled' ||
    subscription.status === 'incomplete_expired'
  );
}

// 期間末の解約の予約は、新しい定期課金ではcancel_at_period_endが偽のままcancel_atだけで表される
export function toSubscriptionSnapshot(
  subscription: Stripe.Subscription,
): StripeSubscriptionSnapshot {
  const { status } = subscription;
  if (!includes(SUBSCRIPTION_STATUSES, status)) {
    throw unexpectedValue('定期課金', 'status', status);
  }
  const periodEnds = subscription.items.data.map(
    (item) => item.current_period_end,
  );
  return {
    id: subscription.id,
    status,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelAt: dateOf(subscription.cancel_at),
    currentPeriodEnd: dateOf(
      periodEnds.length === 0 ? null : Math.max(...periodEnds),
    ),
    endedAt: dateOf(subscription.ended_at),
    customerId:
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id,
    metadata: { ...subscription.metadata },
  };
}
