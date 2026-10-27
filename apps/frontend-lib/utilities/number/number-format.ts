import type { DisplayPreferences } from '../datetime/display-preferences.ts';

export const formatNumber = (
  value: number,
  preferences: DisplayPreferences,
  options?: Intl.NumberFormatOptions,
): string => new Intl.NumberFormat(preferences.locale, options).format(value);
