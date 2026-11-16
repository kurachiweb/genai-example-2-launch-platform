import {
  type BusinessDate,
  type BusinessTimeOfDay,
  businessWeekOf,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../time/business-time.ts';

export const WEEK_ENTRY_PRICE_LOOKUP_KEY = 'week_tournament_entry';

export interface WeekEntryWindow {
  readonly weekStart: BusinessDate;
  readonly acceptUntil: Date;
  readonly deadlineAt: Date;
  readonly drawAt: Date;
}

const ACCEPT_UNTIL_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 23,
  minute: 0,
});
const DEADLINE_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 23,
  minute: 35,
});
const DRAW_TIME: BusinessTimeOfDay = Object.freeze({ hour: 23, minute: 45 });
const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });
const MILLISECONDS_PER_DAY = 86_400_000;
const DAYS_TO_NEXT_MONDAY = 7;
const DAYS_TO_NEXT_TUESDAY = 8;

// 業務時刻は固定のオフセットで夏時間が無いため、0:00に日数分のミリ秒を足した時点の業務日付が日数後の日になる
function addBusinessDays(date: BusinessDate, days: number): BusinessDate {
  const startOfDay = fromBusinessDateTime(date, START_OF_DAY);
  return toBusinessDateTime(
    new Date(startOfDay.getTime() + days * MILLISECONDS_PER_DAY),
  ).date;
}

function assertWeekStart(weekStart: BusinessDate): void {
  if (businessWeekOf(weekStart).start !== weekStart) {
    throw new RangeError(`週の初日は月曜日で指定してください: ${weekStart}`);
  }
}

export function entryWindowFor(weekStart: BusinessDate): WeekEntryWindow {
  assertWeekStart(weekStart);
  const nextMonday = addBusinessDays(weekStart, DAYS_TO_NEXT_MONDAY);
  return Object.freeze({
    weekStart,
    acceptUntil: fromBusinessDateTime(nextMonday, ACCEPT_UNTIL_TIME),
    deadlineAt: fromBusinessDateTime(nextMonday, DEADLINE_TIME),
    drawAt: fromBusinessDateTime(nextMonday, DRAW_TIME),
  });
}

export function weekFirstRoundDate(weekStart: BusinessDate): BusinessDate {
  assertWeekStart(weekStart);
  return addBusinessDays(weekStart, DAYS_TO_NEXT_TUESDAY);
}

export function isSundayLaunch(launchDate: BusinessDate): boolean {
  return businessWeekOf(launchDate).end === launchDate;
}
