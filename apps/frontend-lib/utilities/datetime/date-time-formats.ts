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

export const formatDateTime = (
  value: Date,
  format: DateTimeFormatName,
  preferences: DisplayPreferences,
): string =>
  new Intl.DateTimeFormat(preferences.locale, {
    ...DATE_TIME_FORMATS[format],
    timeZone: preferences.timeZone,
  }).format(value);
