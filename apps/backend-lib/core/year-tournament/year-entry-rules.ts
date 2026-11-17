export const YEAR_ENTRY_STATUSES = Object.freeze([
  'awaiting_payment',
  'entitled',
  'drawn',
  'expired',
  'forfeited',
  'excluded',
] as const);

export type YearEntryStatus = (typeof YEAR_ENTRY_STATUSES)[number];

export const YEAR_ENTRY_CLOSE_REASONS = Object.freeze([
  'deadline',
  'deleted',
  'withdrawn',
  'hidden_or_suspended',
  'over_capacity',
  'late_entry',
] as const);

export type YearEntryCloseReason = (typeof YEAR_ENTRY_CLOSE_REASONS)[number];

export const YEAR_ENTITLEMENT_SOURCES = Object.freeze([
  'payment',
  'ultras',
] as const);

export type YearEntitlementSource = (typeof YEAR_ENTITLEMENT_SOURCES)[number];

export const YEAR_REFUND_STATUSES = Object.freeze([
  'none',
  'pending',
  'requested',
  'not_needed',
  'already_refunded',
  'rejected',
] as const);

export type YearRefundStatus = (typeof YEAR_REFUND_STATUSES)[number];

export const YEAR_REFUND_NOTICE_STATUSES = Object.freeze([
  'none',
  'pending',
  'sent',
  'skipped',
] as const);

export type YearRefundNoticeStatus =
  (typeof YEAR_REFUND_NOTICE_STATUSES)[number];

// 枠は対象年を持たないため、組み合わせ決定の分類で終えるまでの枠の対象年は日程から求める
export const OPEN_ENTRY_STATUSES = Object.freeze([
  'awaiting_payment',
  'entitled',
] as const);

// 一度得た参加資格はUltrasの解約や特典の終了でも戻さないため、資格を与える書き込みの対象は受付中の枠だけにする
export const GRANTABLE_STATUSES = Object.freeze(['awaiting_payment'] as const);

export const YEAR_REFUND_REASONS = Object.freeze([
  'entitlement_lost',
  'entitlement_suspended',
  'capacity_exceeded',
] as const);

export type YearRefundReason = (typeof YEAR_REFUND_REASONS)[number];

export function refundReasonFor(
  status: 'forfeited' | 'excluded',
  closeReason: YearEntryCloseReason,
): YearRefundReason {
  if (status === 'forfeited') {
    return 'entitlement_lost';
  }
  return closeReason === 'over_capacity'
    ? 'capacity_exceeded'
    : 'entitlement_suspended';
}

const REFUND_REQUEST_KEY_PREFIX = 'tournament-year';

export function yearRefundRequestKey(
  purchaseId: string,
  reason: YearRefundReason,
): string {
  return `${REFUND_REQUEST_KEY_PREFIX}:${purchaseId}:${reason}`;
}
