import {
  addBusinessDays as addCalendarDays,
  formatCalendarDate,
  parseCalendarDate,
  utcMidnightOf,
} from '../../../common-lib/time/business-date-arithmetic.ts';

export type BusinessDate = string & { readonly __brand: 'BusinessDate' };
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface BusinessTimeOfDay {
  readonly hour: number;
  readonly minute: number;
}

export interface BusinessDateTime extends BusinessTimeOfDay {
  readonly date: BusinessDate;
  readonly weekday: IsoWeekday;
}

export interface BusinessWeek {
  readonly isoYear: number;
  readonly isoWeek: number;
  readonly start: BusinessDate;
  readonly end: BusinessDate;
}

export const BUSINESS_UTC_OFFSET_MINUTES = -480;

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const ISO_THURSDAY = 4;
const BUSINESS_OFFSET_MILLISECONDS =
  BUSINESS_UTC_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE;

function formatBusinessDate(utcMidnight: Date): BusinessDate {
  return formatCalendarDate(utcMidnight) as BusinessDate;
}

function isoWeekdayOf(utcMidnight: Date): IsoWeekday {
  return (utcMidnight.getUTCDay() || DAYS_PER_WEEK) as IsoWeekday;
}

function addDays(utcMidnight: Date, days: number): Date {
  return new Date(utcMidnight.getTime() + days * MILLISECONDS_PER_DAY);
}

function assertTimeOfDay({ hour, minute }: BusinessTimeOfDay): void {
  const isValid =
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= 0 &&
    hour < HOURS_PER_DAY &&
    minute >= 0 &&
    minute < MINUTES_PER_HOUR;
  if (!isValid) {
    throw new RangeError(
      `業務時刻は0〜23時・0〜59分の整数で指定してください: ${String(hour)}:${String(minute)}`,
    );
  }
}

export function parseBusinessDate(value: string): BusinessDate {
  parseCalendarDate(value);
  return value as BusinessDate;
}

export function toBusinessDateTime(instant: Date): BusinessDateTime {
  const instantMilliseconds = instant.getTime();
  if (Number.isNaN(instantMilliseconds)) {
    throw new RangeError('不正な時点は業務時刻に変換できません');
  }
  // 固定オフセットだけずらした時点のUTCの各欄が、業務時刻の日付と時刻になる
  const shifted = new Date(instantMilliseconds + BUSINESS_OFFSET_MILLISECONDS);
  const utcMidnight = utcMidnightOf({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
  return {
    date: formatBusinessDate(utcMidnight),
    weekday: isoWeekdayOf(utcMidnight),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

export function fromBusinessDateTime(
  date: BusinessDate,
  time: BusinessTimeOfDay,
): Date {
  assertTimeOfDay(time);
  const utcMidnight = utcMidnightOf(parseCalendarDate(date));
  const minutesOfDay = time.hour * MINUTES_PER_HOUR + time.minute;
  return new Date(
    utcMidnight.getTime() +
      minutesOfDay * MILLISECONDS_PER_MINUTE -
      BUSINESS_OFFSET_MILLISECONDS,
  );
}

export function addBusinessDays(
  date: BusinessDate,
  days: number,
): BusinessDate {
  return addCalendarDays(date, days) as BusinessDate;
}

export function businessWeekdayOf(date: BusinessDate): IsoWeekday {
  return isoWeekdayOf(utcMidnightOf(parseCalendarDate(date)));
}

export function businessWeekOf(date: BusinessDate): BusinessWeek {
  const utcMidnight = utcMidnightOf(parseCalendarDate(date));
  const weekday = isoWeekdayOf(utcMidnight);
  const monday = addDays(utcMidnight, 1 - weekday);
  // ISO週は木曜日が属する年の週として数え、第1週はその年の最初の木曜日を含む週になる
  const thursday = addDays(monday, ISO_THURSDAY - 1);
  const isoYear = thursday.getUTCFullYear();
  const januaryFirst = utcMidnightOf({ year: isoYear, month: 1, day: 1 });
  const firstThursday = addDays(
    januaryFirst,
    (ISO_THURSDAY - isoWeekdayOf(januaryFirst) + DAYS_PER_WEEK) % DAYS_PER_WEEK,
  );
  const daysSinceFirstThursday =
    (thursday.getTime() - firstThursday.getTime()) / MILLISECONDS_PER_DAY;
  return {
    isoYear,
    isoWeek: daysSinceFirstThursday / DAYS_PER_WEEK + 1,
    start: formatBusinessDate(monday),
    end: formatBusinessDate(addDays(monday, DAYS_PER_WEEK - 1)),
  };
}

export function toUtcCronExpression(time: BusinessTimeOfDay): string {
  assertTimeOfDay(time);
  const utcHour =
    (time.hour - BUSINESS_UTC_OFFSET_MINUTES / MINUTES_PER_HOUR) %
    HOURS_PER_DAY;
  return `${String(time.minute)} ${String(utcHour)} * * *`;
}
