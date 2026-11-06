import type {
  PaymentRecordKind,
  PaymentRecordStatus,
} from '../../../../../common-lib/payments/payment-record-values.ts';
import type { PurchaseKind } from '../../../../../common-lib/payments/purchase-kinds.ts';
import type { RejectionReason } from '../../../../../common-lib/payments/purchase-states.ts';
import type {
  CheckoutView,
  CheckoutViewStatus,
} from '../../../../application/payments/checkout-view.ts';
import type {
  PaymentHistoryEntry,
  PaymentHistoryPage,
} from '../../../../application/payments/payment-history-reader.ts';
import type {
  Checkout,
  CheckoutRejectionReason,
  CheckoutStatus,
  PaymentRecord,
  PaymentRecordConnection,
  PaymentRecordKind as PaymentRecordKindValue,
  PaymentRecordStatus as PaymentRecordStatusValue,
  PurchaseKind as PurchaseKindValue,
} from '../../generated/resolvers-types.ts';

const PURCHASE_KIND_VALUES: Readonly<Record<PurchaseKind, PurchaseKindValue>> =
  Object.freeze({
    week_tournament_entry: 'WEEK_TOURNAMENT_ENTRY',
    year_tournament_entry: 'YEAR_TOURNAMENT_ENTRY',
    sponsorship: 'SPONSORSHIP',
    ultras: 'ULTRAS',
    payments_smoke: 'PAYMENTS_SMOKE',
  });

const CHECKOUT_STATUS_VALUES: Readonly<
  Record<CheckoutViewStatus, CheckoutStatus>
> = Object.freeze({
  open: 'OPEN',
  processing: 'PROCESSING',
  completed: 'COMPLETED',
  refunding: 'REFUNDING',
  expired: 'EXPIRED',
  unavailable: 'UNAVAILABLE',
});

const REJECTION_REASON_VALUES: Readonly<
  Record<RejectionReason, CheckoutRejectionReason>
> = Object.freeze({
  late: 'LATE',
  ineligible: 'INELIGIBLE',
  duplicate: 'DUPLICATE',
});

const PAYMENT_RECORD_KIND_VALUES: Readonly<
  Record<PaymentRecordKind, PaymentRecordKindValue>
> = Object.freeze({
  one_time: 'ONE_TIME',
  subscription: 'SUBSCRIPTION',
  refund: 'REFUND',
  dispute: 'DISPUTE',
});

const PAYMENT_RECORD_STATUS_VALUES: Readonly<
  Record<PaymentRecordStatus, PaymentRecordStatusValue>
> = Object.freeze({
  succeeded: 'SUCCEEDED',
  failed: 'FAILED',
  pending: 'PENDING',
  disputed: 'DISPUTED',
  dispute_won: 'DISPUTE_WON',
  dispute_lost: 'DISPUTE_LOST',
});

export function toCheckout(view: CheckoutView): Checkout {
  return {
    purchaseId: view.purchaseId,
    kind: PURCHASE_KIND_VALUES[view.kind],
    status: CHECKOUT_STATUS_VALUES[view.status],
    rejectionReason:
      view.rejectionReason === null
        ? null
        : REJECTION_REASON_VALUES[view.rejectionReason],
    clientSecret: view.clientSecret,
    unitPrice: { ...view.unitPrice },
    quantity: view.quantity,
    total: { ...view.total },
    summary: {
      itemName: view.summary.itemName,
      quantityLabel: view.summary.quantityLabel,
      serviceTiming: view.summary.serviceTiming,
      additionalNotes: [...view.summary.additionalNotes],
      isSubscription: view.summary.isSubscription,
    },
    acceptUntil: view.acceptUntil,
    expiresAt: view.expiresAt,
    consentVersion: view.consentVersion,
    canRestart: view.canRestart,
  };
}

function toPaymentRecord(entry: PaymentHistoryEntry): PaymentRecord {
  return {
    id: entry.id,
    kind: PAYMENT_RECORD_KIND_VALUES[entry.kind],
    purpose: PURCHASE_KIND_VALUES[entry.purpose],
    amount: { ...entry.amount },
    quantity: entry.quantity,
    status: PAYMENT_RECORD_STATUS_VALUES[entry.status],
    occurredAt: entry.occurredAt,
  };
}

// 位置は最後の1件のカーソルだけを画面へ返すため、各件のカーソルを落とす
export function toPaymentRecordConnection(
  page: PaymentHistoryPage,
): PaymentRecordConnection {
  return {
    nodes: page.edges.map(({ node }) => toPaymentRecord(node)),
    pageInfo: { ...page.pageInfo },
  };
}
