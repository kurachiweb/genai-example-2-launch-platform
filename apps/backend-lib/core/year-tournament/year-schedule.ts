import {
  addBusinessDays,
  type BusinessDate,
  type BusinessTimeOfDay,
  businessWeekdayOf,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../time/business-time.ts';
import { bracketShape } from '../tournament/bracket-shape.ts';

export const YEAR_ENTRY_PRICE_LOOKUP_KEY = 'year_tournament_entry';
export const YEAR_MAX_PARTICIPANTS = 64;
export const FINAL_DATE_MIN_LEAD_DAYS = 8;
export const FINAL_DATE_MAX_GAP_DAYS = 448;

export interface YearSchedule {
  readonly year: number;
  readonly finalDate: BusinessDate;
  readonly deadlineDate: BusinessDate;
  readonly acceptUntil: Date;
  readonly deadlineAt: Date;
  readonly drawAt: Date;
  readonly changeLockAt: Date;
}

const SUNDAY = 7;
const DEFAULT_FINAL_MONTH_LAST_DAY = '05-31';
const DAYS_FROM_DEADLINE_TO_FINAL = 6;
const DAYS_FROM_CHANGE_LOCK_TO_FINAL = 7;
const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });
const ACCEPT_UNTIL_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 23,
  minute: 0,
});
const DEADLINE_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 23,
  minute: 35,
});
const DRAW_TIME: BusinessTimeOfDay = Object.freeze({ hour: 23, minute: 45 });

function yearOf(date: BusinessDate): number {
  return Number(date.slice(0, 4));
}

function assertSundayFinalDate(finalDate: BusinessDate): void {
  if (businessWeekdayOf(finalDate) !== SUNDAY) {
    throw new RangeError(`決勝日は日曜日で指定してください: ${finalDate}`);
  }
}

export function defaultFinalDate(year: number): BusinessDate {
  const lastDayOfMay = parseBusinessDate(
    `${String(year).padStart(4, '0')}-${DEFAULT_FINAL_MONTH_LAST_DAY}`,
  );
  return addBusinessDays(
    lastDayOfMay,
    -(businessWeekdayOf(lastDayOfMay) % SUNDAY),
  );
}

export function yearScheduleFor(
  year: number,
  finalDate: BusinessDate,
): YearSchedule {
  assertSundayFinalDate(finalDate);
  if (yearOf(finalDate) !== year) {
    throw new RangeError(
      `決勝日は対象年(${String(year)}年)の日付で指定してください: ${finalDate}`,
    );
  }
  const deadlineDate = addBusinessDays(finalDate, -DAYS_FROM_DEADLINE_TO_FINAL);
  return Object.freeze({
    year,
    finalDate,
    deadlineDate,
    acceptUntil: fromBusinessDateTime(deadlineDate, ACCEPT_UNTIL_TIME),
    deadlineAt: fromBusinessDateTime(deadlineDate, DEADLINE_TIME),
    drawAt: fromBusinessDateTime(deadlineDate, DRAW_TIME),
    changeLockAt: fromBusinessDateTime(
      addBusinessDays(finalDate, -DAYS_FROM_CHANGE_LOCK_TO_FINAL),
      START_OF_DAY,
    ),
  });
}

export function yearFirstRoundDate(
  finalDate: BusinessDate,
  participantCount: number,
): BusinessDate | null {
  assertSundayFinalDate(finalDate);
  const { roundCount } = bracketShape(participantCount);
  if (participantCount > YEAR_MAX_PARTICIPANTS) {
    throw new RangeError(
      `参加数は${String(YEAR_MAX_PARTICIPANTS)}以下で指定してください: ${String(participantCount)}`,
    );
  }
  if (roundCount === 0) {
    return null;
  }
  return addBusinessDays(finalDate, -(roundCount - 1));
}
