import { countBusinessDaysInclusive } from '../time/business-date-arithmetic.ts';
import type { BusinessDateString } from './sponsorship-period.ts';

export interface DisplayStopDates {
  readonly fromDate: BusinessDateString;
  // 区間の最後の瞬間を含む日。継続中はnull
  readonly toDate: BusinessDateString | null;
}

interface DateRange {
  readonly from: BusinessDateString;
  readonly to: BusinessDateString;
}

const laterOf = (
  a: BusinessDateString,
  b: BusinessDateString,
): BusinessDateString => (a > b ? a : b);

const earlierOf = (
  a: BusinessDateString,
  b: BusinessDateString,
): BusinessDateString => (a < b ? a : b);

const isNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export const computeUnexposedDays = (input: {
  readonly startsOn: BusinessDateString;
  readonly endsOn: BusinessDateString;
  readonly today: BusinessDateString;
}): number =>
  countBusinessDaysInclusive(
    laterOf(input.today, input.startsOn),
    input.endsOn,
  );

// 浮動小数点の誤差を作らないよう、整数の掛け算の後に割って切り捨てる
export const computeRefundEstimate = (input: {
  readonly amountTotal: number;
  readonly days: number;
  readonly unexposedDays: number;
}): number => {
  const { amountTotal, days, unexposedDays } = input;
  if (
    !isNonNegativeInteger(amountTotal) ||
    !isNonNegativeInteger(days) ||
    days === 0 ||
    !isNonNegativeInteger(unexposedDays) ||
    unexposedDays > days
  ) {
    throw new RangeError(
      `返金目安額を求められない値です: 金額${String(amountTotal)}・日数${String(days)}・未掲載日数${String(unexposedDays)}`,
    );
  }
  return Math.floor((amountTotal * unexposedDays) / days);
};

const mergeOverlapping = (ranges: readonly DateRange[]): DateRange[] =>
  ranges
    .toSorted((a, b) => (a.from < b.from ? -1 : 1))
    .reduce<DateRange[]>((merged, range) => {
      const last = merged.at(-1);
      if (last === undefined || range.from > last.to) {
        return [...merged, range];
      }
      return [
        ...merged.slice(0, -1),
        { from: last.from, to: laterOf(last.to, range.to) },
      ];
    }, []);

export const countStoppedDays = (input: {
  readonly startsOn: BusinessDateString;
  readonly until: BusinessDateString;
  readonly stops: readonly DisplayStopDates[];
}): number => {
  const { startsOn, until } = input;
  if (until < startsOn) {
    return 0;
  }
  const clipped = input.stops.flatMap((stop) => {
    const from = laterOf(stop.fromDate, startsOn);
    const to = earlierOf(stop.toDate ?? until, until);
    return from <= to ? [{ from, to }] : [];
  });
  return mergeOverlapping(clipped).reduce(
    (total, { from, to }) => total + countBusinessDaysInclusive(from, to),
    0,
  );
};
