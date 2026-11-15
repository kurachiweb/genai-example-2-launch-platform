export type MinorUnitAmount = number;

export const PAYMENT_CURRENCY = 'usd';

export const PAYMENT_DISPLAY_CURRENCY = 'USD';

export const MINOR_UNITS_PER_DOLLAR = 100;

export const MAX_MINOR_UNIT_AMOUNT = 10_000_000;

export const isMinorUnitAmount = (value: number): boolean =>
  Number.isInteger(value) && Math.abs(value) <= MAX_MINOR_UNIT_AMOUNT;
