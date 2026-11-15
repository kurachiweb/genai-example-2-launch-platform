import {
  MINOR_UNITS_PER_DOLLAR,
  PAYMENT_DISPLAY_CURRENCY,
} from '../../../common-lib/payments/money.ts';
import { NumberText } from '../datetime/number-text.tsx';

export interface MoneyTextProps {
  readonly amount: number;
  readonly signDisplay?: 'auto' | 'exceptZero';
}

export function MoneyText({ amount, signDisplay = 'auto' }: MoneyTextProps) {
  return (
    <NumberText
      value={amount / MINOR_UNITS_PER_DOLLAR}
      options={{
        style: 'currency',
        currency: PAYMENT_DISPLAY_CURRENCY,
        signDisplay,
      }}
    />
  );
}
