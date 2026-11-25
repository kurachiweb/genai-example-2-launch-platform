export type IsoWeekKey = `${number}-W${string}`;

export interface ParsedIsoWeek {
  readonly weekStart: string;
}

interface IsoWeek {
  readonly year: number;
  readonly week: number;
  readonly monday: Date;
}

const DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;
const WEEK_KEY_PATTERN = /^(?<year>\d{4})-W(?<week>\d{2})$/u;
const MIN_YEAR = 1;
const MIN_WEEK = 1;
const DAYS_PER_WEEK = 7;
const MILLISECONDS_PER_DAY = 86_400_000;
const ISO_THURSDAY = 4;
const YEAR_WIDTH = 4;
const TWO_DIGIT_WIDTH = 2;

function utcMidnightOf(year: number, month: number, day: number): Date {
  const date = new Date(0);
  // Date.UTCは0〜99年を1900年代に読み替えるため、年を直接設定する
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function parseDate(value: string): Date {
  const groups = DATE_PATTERN.exec(value)?.groups;
  if (groups === undefined) {
    throw new RangeError(`日付はYYYY-MM-DDの形式で指定してください: ${value}`);
  }
  const year = Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const date = utcMidnightOf(year, month, day);
  const exists =
    year >= MIN_YEAR &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day;
  if (!exists) {
    throw new RangeError(`存在しない日付です: ${value}`);
  }
  return date;
}

function formatDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(YEAR_WIDTH, '0');
  const month = String(date.getUTCMonth() + 1).padStart(TWO_DIGIT_WIDTH, '0');
  const day = String(date.getUTCDate()).padStart(TWO_DIGIT_WIDTH, '0');
  return `${year}-${month}-${day}`;
}

function formatMonthDay(date: Date): string {
  return `${String(date.getUTCMonth() + 1)}/${String(date.getUTCDate())}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MILLISECONDS_PER_DAY);
}

function mondayOf(date: Date): Date {
  const isoWeekday = date.getUTCDay() || DAYS_PER_WEEK;
  return addDays(date, 1 - isoWeekday);
}

// 1月4日は必ずその年の第1週に入る
function firstMondayOf(isoYear: number): Date {
  return mondayOf(utcMidnightOf(isoYear, 1, 4));
}

// ISO週は木曜日が属する年の週として数える
function isoWeekOf(date: Date): IsoWeek {
  const monday = mondayOf(date);
  const year = addDays(monday, ISO_THURSDAY - 1).getUTCFullYear();
  const days =
    (monday.getTime() - firstMondayOf(year).getTime()) / MILLISECONDS_PER_DAY;
  return { year, week: days / DAYS_PER_WEEK + 1, monday };
}

// 12月28日を含む週がその年の最後のISO週になる
function weeksInIsoYear(isoYear: number): number {
  return isoWeekOf(utcMidnightOf(isoYear, 12, 28)).week;
}

export function weekStartOf(date: string): string {
  return formatDate(mondayOf(parseDate(date)));
}

export function isoWeekKey(weekStart: string): IsoWeekKey {
  const { year, week } = isoWeekOf(parseDate(weekStart));
  const paddedYear = String(year).padStart(YEAR_WIDTH, '0');
  const paddedWeek = String(week).padStart(TWO_DIGIT_WIDTH, '0');
  return `${paddedYear}-W${paddedWeek}` as IsoWeekKey;
}

export function parseIsoWeek(key: string): ParsedIsoWeek | undefined {
  const groups = WEEK_KEY_PATTERN.exec(key)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const year = Number(groups.year);
  const week = Number(groups.week);
  if (year < MIN_YEAR || week < MIN_WEEK || week > weeksInIsoYear(year)) {
    return undefined;
  }
  const monday = addDays(firstMondayOf(year), (week - 1) * DAYS_PER_WEEK);
  return Object.freeze({ weekStart: formatDate(monday) });
}

export function formatWeekPeriodLabel(weekStart: string): string {
  const { year, week, monday } = isoWeekOf(parseDate(weekStart));
  const sunday = addDays(monday, DAYS_PER_WEEK - 1);
  return `${String(year)}年第${String(week)}週(${formatMonthDay(monday)}〜${formatMonthDay(sunday)})`;
}
