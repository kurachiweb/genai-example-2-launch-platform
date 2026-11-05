import { CHECKOUT_CONSENT_VERSION } from '../../../common-lib/payments/checkout-consent.ts';
import {
  type MinorUnitAmount,
  PAYMENT_CURRENCY,
} from '../../../common-lib/payments/money.ts';
import {
  PURCHASE_KIND_MODES,
  type PurchaseKind,
} from '../../../common-lib/payments/purchase-kinds.ts';
import type {
  PurchaseStatus,
  RejectionReason,
} from '../../../common-lib/payments/purchase-states.ts';
import type {
  PurchaseRecord,
  StripeCheckoutSessionSnapshot,
} from '../../../lib/core/payments/ports.ts';
import type { CheckoutSummaryText } from '../../../lib/core/payments/purchase-kind-contract.ts';

// refundingは権利を付与できず全額返金を依頼した購入、unavailableはStripeに到達できずclientSecretを取れない状態
export type CheckoutViewStatus =
  'open' | 'processing' | 'completed' | 'refunding' | 'expired' | 'unavailable';

export interface CheckoutMoney {
  readonly amount: MinorUnitAmount;
  readonly currency: typeof PAYMENT_CURRENCY;
}

export interface CheckoutView {
  readonly purchaseId: string;
  readonly kind: PurchaseKind;
  readonly status: CheckoutViewStatus;
  readonly rejectionReason: RejectionReason | null;
  // 未完了で支払える状態のときだけ返す
  readonly clientSecret: string | null;
  readonly unitPrice: CheckoutMoney;
  readonly quantity: number;
  readonly total: CheckoutMoney;
  readonly summary: CheckoutSummaryText & { readonly isSubscription: boolean };
  readonly acceptUntil: Date | null;
  readonly expiresAt: Date;
  // 決済画面が表示する同意の文言の版
  readonly consentVersion: string;
  readonly canRestart: boolean;
}

// 未完了の購入の決済セッションの取得の結果。unreachableはStripeに到達できなかった、missingは購入にセッションのIDが無い
export type CheckoutSessionLookup =
  | {
      readonly kind: 'retrieved';
      readonly snapshot: StripeCheckoutSessionSnapshot;
    }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'missing' };

const SETTLED_STATUSES: Readonly<
  Record<Exclude<PurchaseStatus, 'open'>, CheckoutViewStatus>
> = Object.freeze({
  processing: 'processing',
  fulfilled: 'completed',
  rejected: 'refunding',
  expired: 'expired',
  superseded: 'expired',
});

export const isPayableOpen = (purchase: PurchaseRecord, now: Date): boolean =>
  purchase.status === 'open' && now.getTime() < purchase.expiresAt.getTime();

interface OpenState {
  readonly status: CheckoutViewStatus;
  readonly clientSecret: string | null;
}

function openStateOf(
  lookup: CheckoutSessionLookup,
  whenUnreachable: CheckoutViewStatus,
): OpenState {
  if (lookup.kind === 'unreachable') {
    return { status: whenUnreachable, clientSecret: null };
  }
  if (lookup.kind === 'missing') {
    return { status: 'unavailable', clientSecret: null };
  }
  const { snapshot } = lookup;
  // Stripe上で完了した決済セッションは、反映が購入を進めるまで処理中として示す
  if (snapshot.status === 'complete') {
    return { status: 'processing', clientSecret: null };
  }
  if (snapshot.status === 'expired') {
    return { status: 'expired', clientSecret: null };
  }
  return snapshot.clientSecret === null
    ? { status: 'unavailable', clientSecret: null }
    : { status: 'open', clientSecret: snapshot.clientSecret };
}

function stateOf(input: {
  readonly purchase: PurchaseRecord;
  readonly now: Date;
  readonly lookup: CheckoutSessionLookup;
  readonly whenUnreachable: CheckoutViewStatus;
}): OpenState {
  const { purchase } = input;
  if (purchase.status !== 'open') {
    return { status: SETTLED_STATUSES[purchase.status], clientSecret: null };
  }
  if (!isPayableOpen(purchase, input.now)) {
    return { status: 'expired', clientSecret: null };
  }
  return openStateOf(input.lookup, input.whenUnreachable);
}

const isBeforeAcceptUntil = (purchase: PurchaseRecord, now: Date): boolean =>
  purchase.acceptUntil === null ||
  now.getTime() < purchase.acceptUntil.getTime();

const moneyOf = (amount: MinorUnitAmount): CheckoutMoney => ({
  amount,
  currency: PAYMENT_CURRENCY,
});

// 決済画面と決済後のランディングが表示する購入の状態と表示事項を組み立てる
export function checkoutViewOf(input: {
  readonly purchase: PurchaseRecord;
  readonly now: Date;
  readonly lookup: CheckoutSessionLookup;
  // Stripeに到達できなかったときの未完了の購入の示し方
  readonly whenUnreachable: Extract<
    CheckoutViewStatus,
    'unavailable' | 'processing'
  >;
}): CheckoutView {
  const { purchase, now } = input;
  const { status, clientSecret } = stateOf(input);
  return {
    purchaseId: purchase.id,
    kind: purchase.kind,
    status,
    rejectionReason: status === 'refunding' ? purchase.rejectionReason : null,
    clientSecret,
    unitPrice: moneyOf(purchase.unitAmount),
    quantity: purchase.quantity,
    total: moneyOf(purchase.amountTotal),
    summary: {
      ...purchase.summary,
      isSubscription: PURCHASE_KIND_MODES[purchase.kind] === 'subscription',
    },
    acceptUntil: purchase.acceptUntil,
    expiresAt: purchase.expiresAt,
    consentVersion: CHECKOUT_CONSENT_VERSION,
    canRestart: status === 'expired' && isBeforeAcceptUntil(purchase, now),
  };
}

// 他人の購入は存在しない購入と区別せず、状態を明かさない
export const isOwnPurchase = (
  purchase: PurchaseRecord | undefined,
  userId: string,
): purchase is PurchaseRecord =>
  purchase !== undefined && purchase.userId === userId;
