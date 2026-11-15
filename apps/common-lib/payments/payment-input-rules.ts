export const CHECKOUT_SESSION_ID_MAX = 255;

export const PAYMENT_HISTORY_PAGE_SIZE_DEFAULT = 20;

export const PAYMENT_HISTORY_PAGE_SIZE_MAX = 50;

export const PAYMENT_HISTORY_CURSOR_MAX = 256;

// StripeのIDは英数字と_だけからなる。長さを先に確かめ、長すぎる値を正規表現にかけない
const CHECKOUT_SESSION_ID_PATTERN = /^cs_[0-9A-Za-z_]+$/u;

export type CheckoutSessionIdIssue = 'invalid';

export const checkCheckoutSessionId = (
  value: string,
): CheckoutSessionIdIssue | undefined =>
  value.length <= CHECKOUT_SESSION_ID_MAX &&
  CHECKOUT_SESSION_ID_PATTERN.test(value)
    ? undefined
    : 'invalid';

export const CHECKOUT_SESSION_ID_MESSAGES: Readonly<
  Record<CheckoutSessionIdIssue, string>
> = Object.freeze({
  invalid: '決済の確認に必要な情報が正しくありません。',
});

export type PaymentHistoryPageSizeIssue = 'out-of-range';

export const checkPaymentHistoryPageSize = (
  value: number,
): PaymentHistoryPageSizeIssue | undefined =>
  Number.isInteger(value) &&
  value >= 1 &&
  value <= PAYMENT_HISTORY_PAGE_SIZE_MAX
    ? undefined
    : 'out-of-range';

export const PAYMENT_HISTORY_PAGE_SIZE_MESSAGES: Readonly<
  Record<PaymentHistoryPageSizeIssue, string>
> = Object.freeze({
  'out-of-range': `表示する件数は1〜${String(PAYMENT_HISTORY_PAGE_SIZE_MAX)}件の整数で指定してください。`,
});
