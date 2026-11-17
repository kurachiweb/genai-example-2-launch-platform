import type { BusinessDate } from '../time/business-time.ts';
import type { YearSchedule } from './year-schedule.ts';

export type YearState = 'planned' | 'open' | 'frozen' | 'not_held';

export interface YearCalendarYear {
  readonly year: number;
  readonly schedule: YearSchedule;
  readonly source: 'explicit' | 'default';
  readonly state: YearState;
}

export type TargetYearResolution =
  | { readonly kind: 'open'; readonly year: YearCalendarYear }
  | { readonly kind: 'late'; readonly year: number };

const MAX_YEARS_TO_LOOK_AHEAD = 4;

function yearOf(date: BusinessDate): number {
  return Number(date.slice(0, 4));
}

export function resolveTargetYear(
  awardedDate: BusinessDate,
  lookup: (year: number) => YearCalendarYear,
): TargetYearResolution {
  const firstYear = yearOf(awardedDate);
  for (let offset = 0; offset < MAX_YEARS_TO_LOOK_AHEAD; offset += 1) {
    const candidate = lookup(firstYear + offset);
    if (
      candidate.state === 'not_held' ||
      awardedDate >= candidate.schedule.deadlineDate
    ) {
      continue;
    }
    if (candidate.state === 'frozen') {
      return Object.freeze({ kind: 'late', year: candidate.year });
    }
    return Object.freeze({ kind: 'open', year: candidate });
  }
  throw new RangeError(
    `Week優勝の日から${String(MAX_YEARS_TO_LOOK_AHEAD)}年の間に対象年がありません: ${awardedDate}`,
  );
}

export function isPreviousYearSet(previous: YearCalendarYear): boolean {
  return previous.state !== 'not_held';
}
