import {
  type BusinessDate,
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../time/business-time.ts';

export interface RoundSchedulePolicy {
  readonly firstRoundDate: BusinessDate;
  nextRoundDate(previousRoundDate: BusinessDate, now: Date): BusinessDate;
}

const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });
const MILLISECONDS_PER_DAY = 86_400_000;

// 業務時刻は固定のオフセットで夏時間が無いため、0:00の24時間後の時点の業務日付が翌日になる
export function nextBusinessDate(date: BusinessDate): BusinessDate {
  const startOfDay = fromBusinessDateTime(date, START_OF_DAY);
  return toBusinessDateTime(
    new Date(startOfDay.getTime() + MILLISECONDS_PER_DAY),
  ).date;
}

function laterOf(a: BusinessDate, b: BusinessDate): BusinessDate {
  return a >= b ? a : b;
}

// 0:00を過ぎてから作る予定は当日のマッチの開始に間に合わないため、現在の業務日付の翌日より早めない
function earliestRoundDate(now: Date): BusinessDate {
  return nextBusinessDate(toBusinessDateTime(now).date);
}

export function dailyRoundPolicy(
  plannedFirstRoundDate: BusinessDate,
  now: Date,
): RoundSchedulePolicy {
  return Object.freeze({
    firstRoundDate: laterOf(plannedFirstRoundDate, earliestRoundDate(now)),
    nextRoundDate(previousRoundDate: BusinessDate, at: Date): BusinessDate {
      return laterOf(
        nextBusinessDate(previousRoundDate),
        earliestRoundDate(at),
      );
    },
  });
}
