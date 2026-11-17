import type { RefundRequestResult } from '../payments/ports.ts';

export const WEEK_ENTRY_STATUSES = Object.freeze([
  'awaiting_payment',
  'entitled',
  'drawn',
  'expired',
  'forfeited',
  'excluded',
] as const);

export type WeekEntryStatus = (typeof WEEK_ENTRY_STATUSES)[number];

export const WEEK_ENTRY_CLOSE_REASONS = Object.freeze([
  'deadline',
  'deleted',
  'withdrawn',
  'hidden_or_suspended',
  'late_entry',
] as const);

export type WeekEntryCloseReason = (typeof WEEK_ENTRY_CLOSE_REASONS)[number];

export const WEEK_ENTITLEMENT_SOURCES = Object.freeze([
  'payment',
  'ultras',
] as const);

export type WeekEntitlementSource = (typeof WEEK_ENTITLEMENT_SOURCES)[number];

export const WEEK_REFUND_STATUSES = Object.freeze([
  'none',
  'pending',
  'requested',
  'not_needed',
  'already_refunded',
  'rejected',
] as const);

export type WeekRefundStatus = (typeof WEEK_REFUND_STATUSES)[number];

export const WEEK_REFUND_NOTICE_STATUSES = Object.freeze([
  'none',
  'pending',
  'sent',
  'skipped',
] as const);

export type WeekRefundNoticeStatus =
  (typeof WEEK_REFUND_NOTICE_STATUSES)[number];

// 一度得た参加資格はUltrasの解約や特典の終了でも戻さないため、資格を与える書き込みの対象は受付中の枠だけにする
export const GRANTABLE_STATUSES = Object.freeze(['awaiting_payment'] as const);

export interface UltrasExemptionPeriod {
  readonly from: Date;
  readonly to: Date;
}

// Ultrasの加入の知らせの処理が参加資格を付与するまでの間も免除として扱うため、終わりは現在と決済期限の早い方にする。決済期限の後の加入は付与されないため期間に含めない。
// 終わりより後に確定した勝利は期間が空で、特典の判定は始まりが終わりより後の期間を例外にするため、nullを返して問い合わせさせない
export function ultrasExemptionPeriodOf(
  wonAt: Date,
  deadlineAt: Date,
  now: Date = deadlineAt,
): UltrasExemptionPeriod | null {
  const to = now.getTime() < deadlineAt.getTime() ? now : deadlineAt;
  if (wonAt.getTime() > to.getTime()) {
    return null;
  }
  return Object.freeze({ from: wonAt, to });
}

export const WEEK_REFUND_REASONS = Object.freeze([
  'entitlement_lost',
  'entitlement_suspended',
] as const);

export type WeekRefundReason = (typeof WEEK_REFUND_REASONS)[number];

const REFUND_REASONS: Readonly<
  Record<'forfeited' | 'excluded', WeekRefundReason>
> = Object.freeze({
  forfeited: 'entitlement_lost',
  excluded: 'entitlement_suspended',
});

export function refundReasonFor(
  status: 'forfeited' | 'excluded',
): WeekRefundReason {
  return REFUND_REASONS[status];
}

const REFUND_REQUEST_KEY_PREFIX = 'tournament-week';

export function weekRefundRequestKey(
  purchaseId: string,
  reason: WeekRefundReason,
): string {
  return `${REFUND_REQUEST_KEY_PREFIX}:${purchaseId}:${reason}`;
}

export type WeekRefundRejectionCode = Extract<
  RefundRequestResult,
  { readonly kind: 'rejected' }
>['code'];

export type WeekRefundRejectionOutcome =
  | { readonly refundStatus: 'not_needed'; readonly report: false }
  | { readonly refundStatus: 'already_refunded'; readonly report: true }
  | { readonly refundStatus: 'rejected'; readonly report: true };

const NOT_NEEDED: WeekRefundRejectionOutcome = Object.freeze({
  refundStatus: 'not_needed',
  report: false,
});

// 管理者の返金や異議で既に返金できる残額が無い購入は、返金済みとして依頼を終えるが、自動の依頼と食い違うため運用者へ知らせる
const ALREADY_REFUNDED: WeekRefundRejectionOutcome = Object.freeze({
  refundStatus: 'already_refunded',
  report: true,
});

// 依頼の形式の誤りは再処理しても直らないため、再処理の対象から外して運用者へ知らせる
const REJECTED: WeekRefundRejectionOutcome = Object.freeze({
  refundStatus: 'rejected',
  report: true,
});

const REJECTION_OUTCOMES: Readonly<
  Record<WeekRefundRejectionCode, WeekRefundRejectionOutcome>
> = Object.freeze({
  not_paid: NOT_NEEDED,
  purchase_not_found: NOT_NEEDED,
  amount_exceeds_refundable: ALREADY_REFUNDED,
  invalid_amount: REJECTED,
  invalid_request_key: REJECTED,
});

export function refundRejectionOutcome(
  code: WeekRefundRejectionCode,
): WeekRefundRejectionOutcome {
  return REJECTION_OUTCOMES[code];
}
