import {
  isMinorUnitAmount,
  type MinorUnitAmount,
} from '../../../common-lib/payments/money.ts';

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
