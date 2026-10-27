import type { DisplayPreferences } from '../datetime/display-preferences.ts';

// Intlのオブジェクトの生成は整形より重いため、表示設定のオブジェクトが生きている間だけ指定の内容ごとに使い回す
const formattersByPreferences = new WeakMap<
  DisplayPreferences,
  Map<string, Intl.NumberFormat>
>();

const formatterOf = (
  preferences: DisplayPreferences,
  options: Intl.NumberFormatOptions | undefined,
): Intl.NumberFormat => {
  const formatters =
    formattersByPreferences.get(preferences) ??
    new Map<string, Intl.NumberFormat>();
  if (!formattersByPreferences.has(preferences)) {
    formattersByPreferences.set(preferences, formatters);
  }
  const key = JSON.stringify(options ?? {});
  const cached = formatters.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.NumberFormat(preferences.locale, options);
  formatters.set(key, formatter);
  return formatter;
};

export const formatNumber = (
  value: number,
  preferences: DisplayPreferences,
  options?: Intl.NumberFormatOptions,
): string => formatterOf(preferences, options).format(value);
