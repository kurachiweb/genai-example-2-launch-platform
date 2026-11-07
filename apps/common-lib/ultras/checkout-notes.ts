import {
  MINOR_UNITS_PER_DOLLAR,
  type MinorUnitAmount,
  PAYMENT_DISPLAY_CURRENCY,
} from '../payments/money.ts';

// 同じ文字列を最終確認画面と購入確認メールの両方が使うため、閲覧者のロケールに依らない固定の表示形式で作る
const MONTHLY_AMOUNT_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: PAYMENT_DISPLAY_CURRENCY,
});

export const ULTRAS_CANCELLATION_NOTE =
  '解約はプラン管理画面からいつでも行え、解約した後も課金期間の末日まで特典が続きます。';

export const ULTRAS_NO_PRORATED_REFUND_NOTE =
  '課金期間の途中で解約しても、日割りの返金はありません。';

export const ULTRAS_ENTRY_FEE_NOT_REFUNDED_NOTE =
  '支払い済みのトーナメント参加費は返金されません。';

export type UltrasCheckoutNotes = readonly [string, string, string, string];

export function formatUltrasMonthlyAmount(amount: MinorUnitAmount): string {
  return `${MONTHLY_AMOUNT_FORMAT.format(amount / MINOR_UNITS_PER_DOLLAR)}(税込)`;
}

export function ultrasAutoRenewalNoteOf(amount: MinorUnitAmount): string {
  return `Ultrasプランは毎月自動で更新され、毎月の更新日に${formatUltrasMonthlyAmount(amount)}を自動でお支払いいただきます。`;
}

// 最終確認画面は各文を鍵にして描くため、4つの文は互いに異なる
export function ultrasCheckoutNotesOf(
  amount: MinorUnitAmount,
): UltrasCheckoutNotes {
  return Object.freeze([
    ultrasAutoRenewalNoteOf(amount),
    ULTRAS_CANCELLATION_NOTE,
    ULTRAS_NO_PRORATED_REFUND_NOTE,
    ULTRAS_ENTRY_FEE_NOT_REFUNDED_NOTE,
  ] as const);
}
