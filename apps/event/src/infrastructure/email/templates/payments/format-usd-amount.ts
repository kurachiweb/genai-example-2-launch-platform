import {
  MINOR_UNITS_PER_DOLLAR,
  type MinorUnitAmount,
  PAYMENT_DISPLAY_CURRENCY,
} from '../../../../../common-lib/payments/money.ts';

// メールは受信者のロケールを知り得ないため、ロケールを固定して通貨の記号に通貨のコードを添える
const USD_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: PAYMENT_DISPLAY_CURRENCY,
});

export function formatUsdAmount(amount: MinorUnitAmount): string {
  return `${USD_FORMAT.format(amount / MINOR_UNITS_PER_DOLLAR)} ${PAYMENT_DISPLAY_CURRENCY}`;
}
