import {
  addBusinessDays,
  type BusinessDate,
  toBusinessDateTime,
} from '../time/business-time.ts';

export interface RoundSchedulePolicy {
  readonly firstRoundDate: BusinessDate;
  nextRoundDate(previousRoundDate: BusinessDate, now: Date): BusinessDate;
}

function laterOf(a: BusinessDate, b: BusinessDate): BusinessDate {
  return a >= b ? a : b;
}

// 0:00を過ぎてから作る予定は当日のマッチの開始に間に合わないため、現在の業務日付の翌日より早めない
function earliestRoundDate(now: Date): BusinessDate {
  return addBusinessDays(toBusinessDateTime(now).date, 1);
}

export function dailyRoundPolicy(
  plannedFirstRoundDate: BusinessDate,
  now: Date,
): RoundSchedulePolicy {
  return Object.freeze({
    firstRoundDate: laterOf(plannedFirstRoundDate, earliestRoundDate(now)),
    nextRoundDate(previousRoundDate: BusinessDate, at: Date): BusinessDate {
      return laterOf(
        addBusinessDays(previousRoundDate, 1),
        earliestRoundDate(at),
      );
    },
  });
}
