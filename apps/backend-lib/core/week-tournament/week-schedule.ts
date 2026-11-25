import {
  addBusinessDays,
  type BusinessDate,
  type BusinessTimeOfDay,
  businessWeekOf,
  fromBusinessDateTime,
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
const DAYS_TO_NEXT_MONDAY = 7;
const DAYS_TO_NEXT_TUESDAY = 8;

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
