import type { DisplayPreferences } from './display-preferences.ts';

export type DateTimeFormatName =
  | 'time'
  | 'date'
  | 'dateWeekday'
  | 'yearDate'
  | 'longDate'
  | 'dateTime'
  | 'longDateTime';

export const DATE_TIME_FORMATS: Readonly<
  Record<DateTimeFormatName, Intl.DateTimeFormatOptions>
> = {
  time: { hour: '2-digit', minute: '2-digit' },
  date: { month: 'long', day: 'numeric' },
  dateWeekday: { month: 'long', day: 'numeric', weekday: 'short' },
  yearDate: { year: 'numeric', month: 'long', day: 'numeric' },
  longDate: {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  },
  dateTime: {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  },
  longDateTime: {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  },
};

// Intlのオブジェクトの生成は整形より重いため、表示設定のオブジェクトが生きている間だけ書式ごとに使い回す
const formattersByPreferences = new WeakMap<
  DisplayPreferences,
  Map<DateTimeFormatName, Intl.DateTimeFormat>
>();

const formatterOf = (
  format: DateTimeFormatName,
  preferences: DisplayPreferences,
): Intl.DateTimeFormat => {
  const formatters =
    formattersByPreferences.get(preferences) ??
    new Map<DateTimeFormatName, Intl.DateTimeFormat>();
  if (!formattersByPreferences.has(preferences)) {
    formattersByPreferences.set(preferences, formatters);
  }
  const cached = formatters.get(format);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(preferences.locale, {
    ...DATE_TIME_FORMATS[format],
    timeZone: preferences.timeZone,
  });
  formatters.set(format, formatter);
  return formatter;
};

export const formatDateTime = (
  value: Date,
  format: DateTimeFormatName,
  preferences: DisplayPreferences,
): string => formatterOf(format, preferences).format(value);
