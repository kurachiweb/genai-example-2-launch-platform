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
  readonly previous: StatisticsWeekRange;
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

export function weeksToCompute(now: Date): StatisticsWeeksToCompute {
  const current = weekOf(now);
  return Object.freeze({ current, previous: previousWeek(current) });
}

export function isWeekFinished(week: StatisticsWeekRange, now: Date): boolean {
  return week.to.getTime() <= now.getTime();
}

export function lastDayOf(week: StatisticsWeekRange): BusinessDate {
  return businessWeekOf(week.weekStart).end;
}
