import { useSyncExternalStore } from 'react';

export type DateTimeStyle =
  | 'time'
  | 'date'
  | 'dateWeekday'
  | 'yearDate'
  | 'longDate'
  | 'dateTime'
  | 'longDateTime';

const STYLE_OPTIONS: Record<DateTimeStyle, Intl.DateTimeFormatOptions> = {
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

function buildFormatters(
  locale: string | undefined,
  timeZone: string | undefined,
) {
  return Object.fromEntries(
    (Object.keys(STYLE_OPTIONS) as DateTimeStyle[]).map((style) => [
      style,
      new Intl.DateTimeFormat(locale, { ...STYLE_OPTIONS[style], timeZone }),
    ]),
  ) as Record<DateTimeStyle, Intl.DateTimeFormat>;
}

// SSRとハイドレーション中はサーバーとブラウザで結果が一致するよう固定ロケール・UTCで整形し、マウント後にブラウザのロケール・タイムゾーンへ切り替える
const ssrFormatters = buildFormatters('ja-JP', 'UTC');
const browserFormatters = buildFormatters(undefined, undefined);

function subscribe() {
  return () => {};
}

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function useDateTimeFormatter(
  style: DateTimeStyle,
): Intl.DateTimeFormat {
  const hydrated = useHydrated();
  return (hydrated ? browserFormatters : ssrFormatters)[style];
}
