export interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const MILLISECONDS_PER_DAY = 86_400_000;
const MIN_YEAR = 1;
const CALENDAR_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

export function utcMidnightOf({ year, month, day }: CalendarDate): Date {
  const date = new Date(0);
  // Date.UTCは0〜99年を1900年代に読み替えるため、年を直接設定する
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

export function formatCalendarDate(utcMidnight: Date): string {
  const year = String(utcMidnight.getUTCFullYear()).padStart(4, '0');
  const month = String(utcMidnight.getUTCMonth() + 1).padStart(2, '0');
  const day = String(utcMidnight.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseCalendarDate(value: string): CalendarDate {
  const groups = CALENDAR_DATE_PATTERN.exec(value)?.groups;
  if (groups === undefined) {
    throw new RangeError(
      `業務日付はYYYY-MM-DDの形式で指定してください: ${value}`,
    );
  }
  const calendarDate = {
    year: Number(groups.year),
    month: Number(groups.month),
    day: Number(groups.day),
  };
  const utcMidnight = utcMidnightOf(calendarDate);
  const exists =
    calendarDate.year >= MIN_YEAR &&
    utcMidnight.getUTCFullYear() === calendarDate.year &&
    utcMidnight.getUTCMonth() + 1 === calendarDate.month &&
    utcMidnight.getUTCDate() === calendarDate.day;
  if (!exists) {
    throw new RangeError(`存在しない業務日付です: ${value}`);
  }
  return calendarDate;
}

export function addBusinessDays(date: string, days: number): string {
  const utcMidnight = utcMidnightOf(parseCalendarDate(date));
  return formatCalendarDate(
    new Date(utcMidnight.getTime() + days * MILLISECONDS_PER_DAY),
  );
}

// 暦日のUTCの0:00同士の差を使う。UTCは夏時間を持たないため、差は1日の倍数で割り切れる
export function countBusinessDaysInclusive(from: string, to: string): number {
  const fromMidnight = utcMidnightOf(parseCalendarDate(from));
  const toMidnight = utcMidnightOf(parseCalendarDate(to));
  const days =
    (toMidnight.getTime() - fromMidnight.getTime()) / MILLISECONDS_PER_DAY + 1;
  return Math.max(days, 0);
}
