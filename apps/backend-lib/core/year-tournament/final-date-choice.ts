import {
  addBusinessDays,
  type BusinessDate,
  type BusinessTimeOfDay,
  businessWeekdayOf,
  fromBusinessDateTime,
  parseBusinessDate,
  toBusinessDateTime,
} from '../time/business-time.ts';
import {
  FINAL_DATE_MAX_GAP_DAYS,
  FINAL_DATE_MIN_LEAD_DAYS,
  type YearSchedule,
} from './year-schedule.ts';

export type FinalDateViolation =
  | 'year_not_editable'
  | 'not_sunday'
  | 'out_of_year'
  | 'too_soon'
  | 'too_far_from_previous'
  | 'too_far_from_next'
  | 'locked';

export interface FinalDateContext {
  readonly year: number;
  readonly now: Date;
  readonly current: YearSchedule;
  readonly drawStarted: boolean;
  readonly previousFinalDate: BusinessDate | null;
  readonly nextExplicitFinalDate: BusinessDate | null;
}

export interface NextYearGapWarningInput {
  readonly finalDate: BusinessDate;
  readonly nextYearDefault: BusinessDate | null;
}

const SUNDAY = 7;
const DAYS_PER_WEEK = 7;
const MILLISECONDS_PER_DAY = 86_400_000;
const MIN_LEAD_MILLISECONDS = FINAL_DATE_MIN_LEAD_DAYS * MILLISECONDS_PER_DAY;
const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });

function yearOf(date: BusinessDate): number {
  return Number(date.slice(0, 4));
}

function firstSundayOf(year: number): BusinessDate {
  const firstDay = parseBusinessDate(`${String(year).padStart(4, '0')}-01-01`);
  return addBusinessDays(
    firstDay,
    (SUNDAY - businessWeekdayOf(firstDay)) % DAYS_PER_WEEK,
  );
}

function sundaysOf(year: number): readonly BusinessDate[] {
  const sundays: BusinessDate[] = [];
  for (
    let sunday = firstSundayOf(year);
    yearOf(sunday) === year;
    sunday = addBusinessDays(sunday, DAYS_PER_WEEK)
  ) {
    sundays.push(sunday);
  }
  return sundays;
}

function isEditableYear(year: number, now: Date): boolean {
  return editableYears(now).includes(year);
}

function isTooSoon(date: BusinessDate, now: Date): boolean {
  return (
    fromBusinessDateTime(date, START_OF_DAY).getTime() <
    now.getTime() + MIN_LEAD_MILLISECONDS
  );
}

function isAtLeastMaxGapApart(
  earlier: BusinessDate,
  later: BusinessDate,
): boolean {
  return later >= addBusinessDays(earlier, FINAL_DATE_MAX_GAP_DAYS);
}

export function editableYears(now: Date): readonly [number, number] {
  const currentYear = yearOf(toBusinessDateTime(now).date);
  return [currentYear, currentYear + 1];
}

export function isFinalDateChangeable(context: FinalDateContext): boolean {
  return (
    context.now.getTime() < context.current.changeLockAt.getTime() &&
    !context.drawStarted
  );
}

export function checkFinalDateChoice(
  date: BusinessDate,
  context: FinalDateContext,
): FinalDateViolation | null {
  if (!isEditableYear(context.year, context.now)) {
    return 'year_not_editable';
  }
  if (!isFinalDateChangeable(context)) {
    return 'locked';
  }
  if (businessWeekdayOf(date) !== SUNDAY) {
    return 'not_sunday';
  }
  if (yearOf(date) !== context.year) {
    return 'out_of_year';
  }
  if (isTooSoon(date, context.now)) {
    return 'too_soon';
  }
  if (
    context.previousFinalDate !== null &&
    isAtLeastMaxGapApart(context.previousFinalDate, date)
  ) {
    return 'too_far_from_previous';
  }
  if (
    context.nextExplicitFinalDate !== null &&
    isAtLeastMaxGapApart(date, context.nextExplicitFinalDate)
  ) {
    return 'too_far_from_next';
  }
  return null;
}

export function finalDateChoices(
  context: FinalDateContext,
): readonly BusinessDate[] {
  if (
    !isEditableYear(context.year, context.now) ||
    !isFinalDateChangeable(context)
  ) {
    return [];
  }
  return sundaysOf(context.year).filter(
    (sunday) => checkFinalDateChoice(sunday, context) === null,
  );
}

export function nextYearGapWarning(
  input: NextYearGapWarningInput,
): BusinessDate | null {
  if (
    input.nextYearDefault === null ||
    !isAtLeastMaxGapApart(input.finalDate, input.nextYearDefault)
  ) {
    return null;
  }
  return input.nextYearDefault;
}
