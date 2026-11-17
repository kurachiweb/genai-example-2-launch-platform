import type { RefundRequestResult } from '../payments/ports.ts';

export type RefundRejectionCode = Extract<
  RefundRequestResult,
  { readonly kind: 'rejected' }
>['code'];

export type RefundRejectionOutcome =
  | { readonly refundStatus: 'not_needed'; readonly report: false }
  | { readonly refundStatus: 'already_refunded'; readonly report: true }
  | { readonly refundStatus: 'rejected'; readonly report: true };

const NOT_NEEDED: RefundRejectionOutcome = Object.freeze({
  refundStatus: 'not_needed',
  report: false,
});

// 管理者の返金や異議で既に返金できる残額が無い購入は、返金済みとして依頼を終えるが、自動の依頼と食い違うため運用者へ知らせる
const ALREADY_REFUNDED: RefundRejectionOutcome = Object.freeze({
  refundStatus: 'already_refunded',
  report: true,
});

// 依頼の形式の誤りは再処理しても直らないため、再処理の対象から外して運用者へ知らせる
const REJECTED: RefundRejectionOutcome = Object.freeze({
  refundStatus: 'rejected',
  report: true,
});

const REJECTION_OUTCOMES: Readonly<
  Record<RefundRejectionCode, RefundRejectionOutcome>
> = Object.freeze({
  not_paid: NOT_NEEDED,
  purchase_not_found: NOT_NEEDED,
  amount_exceeds_refundable: ALREADY_REFUNDED,
  invalid_amount: REJECTED,
  invalid_request_key: REJECTED,
});

export function refundRejectionOutcome(
  code: RefundRejectionCode,
): RefundRejectionOutcome {
  return REJECTION_OUTCOMES[code];
}
