import { describe, expect, test } from 'bun:test';

import {
  isMinorUnitAmount,
  MAX_MINOR_UNIT_AMOUNT,
  MINOR_UNITS_PER_DOLLAR,
  PAYMENT_CURRENCY,
  PAYMENT_DISPLAY_CURRENCY,
} from './money.ts';

describe('通貨', () => {
  test('Stripeと記録に使う通貨はISO 4217の小文字のusdになる', () => {
    expect(PAYMENT_CURRENCY).toBe('usd');
  });

  test('表示に使う通貨コードは大文字のUSDになる', () => {
    expect(PAYMENT_DISPLAY_CURRENCY).toBe('USD');
  });

  test('1ドルは100セントになる', () => {
    expect(MINOR_UNITS_PER_DOLLAR).toBe(100);
  });
});

describe('isMinorUnitAmount', () => {
  test('金額の絶対値の上限は10,000,000セントになる', () => {
    expect(MAX_MINOR_UNIT_AMOUNT).toBe(10_000_000);
  });

  test.each([0, 1, 500, -4800, 10_000_000, -10_000_000])(
    '整数で上限以内の%pを受け付ける',
    (value) => {
      expect(isMinorUnitAmount(value)).toBe(true);
    },
  );

  test.each([0.5, -0.01, 100.1])('小数の%pを拒否する', (value) => {
    expect(isMinorUnitAmount(value)).toBe(false);
  });

  test.each([10_000_001, -10_000_001, Number.MAX_SAFE_INTEGER])(
    '上限を超える%pを拒否する',
    (value) => {
      expect(isMinorUnitAmount(value)).toBe(false);
    },
  );

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    '数でない値や無限の%pを拒否する',
    (value) => {
      expect(isMinorUnitAmount(value)).toBe(false);
    },
  );
});
