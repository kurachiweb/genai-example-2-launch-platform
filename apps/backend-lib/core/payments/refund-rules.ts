import {
  isMinorUnitAmount,
  type MinorUnitAmount,
} from '../../../common-lib/payments/money.ts';
import type { PaymentRecordStatus } from '../../../common-lib/payments/payment-record-values.ts';
import type { RefundRequestStatus } from '../../../common-lib/payments/purchase-states.ts';
import type { StripeRefundStatus } from './ports.ts';

export type RefundAmountValidation =
  | { readonly kind: 'ok'; readonly amount: MinorUnitAmount }
  | {
      readonly kind: 'invalid';
      readonly code: 'invalid_amount' | 'amount_exceeds_refundable';
    };

export function validateRefundAmount(input: {
  readonly requested: MinorUnitAmount | null;
  readonly paid: MinorUnitAmount;
  // failed・canceledを除く返金の依頼の合計
  readonly alreadyRequested: MinorUnitAmount;
}): RefundAmountValidation {
  const refundable = input.paid - input.alreadyRequested;
  if (
    input.requested !== null &&
    (!isMinorUnitAmount(input.requested) || input.requested <= 0)
  ) {
    return { kind: 'invalid', code: 'invalid_amount' };
  }
  const amount = input.requested ?? refundable;
  if (amount <= 0 || amount > refundable) {
    return { kind: 'invalid', code: 'amount_exceeds_refundable' };
  }
  return { kind: 'ok', amount };
}

export type StripeRefundReason = 'duplicate' | 'requested_by_customer';

// 返金の理由は依頼元が定める自由な値のため、二重決済だけをStripeのduplicateに対応させ、他は購入者の都合として扱う
export function toStripeRefundReason(reason: string): StripeRefundReason {
  return reason === 'duplicate' ? 'duplicate' : 'requested_by_customer';
}

// 自動返金(反映の期限切れ・付与できない・二重決済)だけが使う依頼キーの接頭辞。後続specの依頼を自動返金と区別する
export const REFLECTION_REQUEST_KEY_PREFIX = 'reflection:';

export const MAX_REQUEST_KEY_LENGTH = 128;

const REFUND_REASON_PATTERN = /^[a-z0-9_]{1,64}$/u;

export function reflectionRequestKeyOf(purchaseId: string): string {
  return `${REFLECTION_REQUEST_KEY_PREFIX}${purchaseId}`;
}

export function isReflectionRequestKey(requestKey: string): boolean {
  return requestKey.startsWith(REFLECTION_REQUEST_KEY_PREFIX);
}

// 依頼元(後続spec)の経路が受け付ける依頼キー
export function isAcceptableRequestKey(requestKey: string): boolean {
  return (
    requestKey.length >= 1 &&
    requestKey.length <= MAX_REQUEST_KEY_LENGTH &&
    !isReflectionRequestKey(requestKey)
  );
}

export function isRefundReason(reason: string): boolean {
  return REFUND_REASON_PATTERN.test(reason);
}

// Stripeの返金の状態を決済履歴の状態にする。取り消しは返金されないため失敗として残す
export function refundRecordStatusOf(
  status: StripeRefundStatus,
): Extract<PaymentRecordStatus, 'pending' | 'succeeded' | 'failed'> {
  switch (status) {
    case 'pending':
    case 'requires_action':
      return 'pending';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'canceled':
      return 'failed';
  }
}

export interface RefundRequestReflection {
  readonly status: RefundRequestStatus;
  // 反映の前の依頼の状態がこの中にあるときだけ進める。完了した依頼を処理中へ戻さない
  readonly from: readonly RefundRequestStatus[];
}

// 成功の後の失敗(Stripeの返金は成功の後に失敗し得る)は受け入れる
const REFUND_REQUEST_REFLECTIONS: Readonly<
  Record<StripeRefundStatus, RefundRequestReflection>
> = {
  pending: { status: 'submitted', from: ['requested', 'submitted'] },
  requires_action: { status: 'submitted', from: ['requested', 'submitted'] },
  succeeded: {
    status: 'succeeded',
    from: ['requested', 'submitted', 'succeeded'],
  },
  failed: {
    status: 'failed',
    from: ['requested', 'submitted', 'succeeded', 'failed'],
  },
  canceled: {
    status: 'canceled',
    from: ['requested', 'submitted', 'canceled'],
  },
};

export function refundRequestReflectionOf(
  status: StripeRefundStatus,
): RefundRequestReflection {
  return REFUND_REQUEST_REFLECTIONS[status];
}
