import { useMemo } from 'react';

import { useHydrated } from '#/lib/date-format';

import { TODAY, calendarDate, yearOf } from '../-model/calendar';
import type { DateRange } from '../-model/query';

export type DirectoryFormat = {
  // ローンチ日。今年なら年を省略する「9月21日(月)」
  launchDate: (iso: string) => string;
  // 期間の端。曜日を付けない「9月21日」
  day: (iso: string) => string;
  rangeLabel: (range: DateRange) => string;
  number: (value: number) => string;
};

// ローンチ日は基準時刻の暦日のため、タイムゾーン変換せずUTCとして整形する。SSRとハイドレーション中は固定ロケールにする
export function useDirectoryFormat(): DirectoryFormat {
  const hydrated = useHydrated();
  const locale = hydrated ? undefined : 'ja-JP';

  return useMemo(() => {
    const thisYear = yearOf(TODAY);
    const formatter = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
    const date = {
      withYear: formatter({
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }),
      withoutYear: formatter({
        month: 'long',
        day: 'numeric',
        weekday: 'short',
      }),
      dayWithYear: formatter({
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      dayWithoutYear: formatter({ month: 'long', day: 'numeric' }),
    };
    const numberFormatter = new Intl.NumberFormat(locale);
    const isThisYear = (iso: string) => yearOf(iso) === thisYear;

    const launchDate = (iso: string) =>
      (isThisYear(iso) ? date.withoutYear : date.withYear).format(
        calendarDate(iso),
      );
    const day = (iso: string) =>
      (isThisYear(iso) ? date.dayWithoutYear : date.dayWithYear).format(
        calendarDate(iso),
      );
    const rangeLabel = (range: DateRange) => {
      if (range.from && range.to) {
        return range.from === range.to
          ? day(range.from)
          : `${day(range.from)}〜${day(range.to)}`;
      }
      if (range.from) return `${day(range.from)}以降`;
      if (range.to) return `${day(range.to)}以前`;
      return '全期間';
    };

    return {
      launchDate,
      day,
      rangeLabel,
      number: (value: number) => numberFormatter.format(value),
    };
  }, [locale]);
}
