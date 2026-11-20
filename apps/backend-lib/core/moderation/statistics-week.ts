import {
  addBusinessDays,
  type BusinessDate,
  type BusinessTimeOfDay,
  businessWeekOf,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../time/business-time.ts';

export interface StatisticsWeekRange {
  readonly weekStart: BusinessDate;
  readonly from: Date;
  readonly to: Date;
}

export interface StatisticsWeeksToCompute {
  readonly current: StatisticsWeekRange;
  // 週の古い順
  readonly finished: readonly StatisticsWeekRange[];
}

const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });
const DAYS_PER_WEEK = 7;

function rangeStartingAt(weekStart: BusinessDate): StatisticsWeekRange {
  return Object.freeze({
    weekStart,
    from: fromBusinessDateTime(weekStart, START_OF_DAY),
    to: fromBusinessDateTime(
      addBusinessDays(weekStart, DAYS_PER_WEEK),
      START_OF_DAY,
    ),
  });
}

export function weekOf(at: Date): StatisticsWeekRange {
  return rangeStartingAt(businessWeekOf(toBusinessDateTime(at).date).start);
}

export function previousWeek(week: StatisticsWeekRange): StatisticsWeekRange {
  return rangeStartingAt(addBusinessDays(week.weekStart, -DAYS_PER_WEEK));
}

export function weeksToCompute(
  now: Date,
  finishedWeeks: number,
): StatisticsWeeksToCompute {
  if (!Number.isInteger(finishedWeeks) || finishedWeeks < 0) {
    throw new RangeError(
      `終わった週の数は0以上の整数で指定してください: ${String(finishedWeeks)}`,
    );
  }
  const current = weekOf(now);
  const finished = Array.from({ length: finishedWeeks }, (_, index) =>
    rangeStartingAt(
      addBusinessDays(
        current.weekStart,
        (index - finishedWeeks) * DAYS_PER_WEEK,
      ),
    ),
  );
  return Object.freeze({ current, finished: Object.freeze(finished) });
}

export function isWeekFinished(week: StatisticsWeekRange, now: Date): boolean {
  return week.to.getTime() <= now.getTime();
}

export function lastDayOf(week: StatisticsWeekRange): BusinessDate {
  return businessWeekOf(week.weekStart).end;
}
