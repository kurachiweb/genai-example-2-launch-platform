import {
  addBusinessDays,
  countBusinessDaysInclusive,
  parseCalendarDate,
} from '../time/business-date-arithmetic.ts';

// YYYY-MM-DDの固定長のため、文字列の大小が日付の前後と一致する
export type BusinessDateString = string;

export const SPONSORSHIP_MAX_DAYS = 366;
export const SPONSORSHIP_MAX_LEAD_DAYS = 365;

export type SponsorshipDateUnavailableReason =
  'past' | 'out_of_range' | 'before_start' | 'too_long' | 'overlap';

export interface SponsorshipDatePeriod {
  readonly startsOn: BusinessDateString;
  readonly endsOn: BusinessDateString;
}

export interface SponsorshipUnavailableRange {
  readonly from: BusinessDateString;
  readonly to: BusinessDateString;
  readonly reason: 'overlap';
}

export interface SponsorshipDateWindow {
  readonly earliest: BusinessDateString;
  readonly latest: BusinessDateString;
  readonly unavailable: readonly SponsorshipUnavailableRange[];
}

export interface SponsorshipPeriodWindows {
  readonly start: SponsorshipDateWindow;
  readonly end: SponsorshipDateWindow | null;
}

export interface PeriodViolations {
  readonly startsOn?: 'invalid' | 'past' | 'too-far';
  readonly endsOn?: 'invalid' | 'before-start' | 'too-long';
}

const isCalendarDate = (value: string): boolean => {
  try {
    parseCalendarDate(value);
    return true;
  } catch (error) {
    if (error instanceof RangeError) {
      return false;
    }
    throw error;
  }
};

const laterOf = (
  a: BusinessDateString,
  b: BusinessDateString,
): BusinessDateString => (a > b ? a : b);

const earlierOf = (
  a: BusinessDateString,
  b: BusinessDateString,
): BusinessDateString => (a < b ? a : b);

export const periodsOverlap = (
  a: SponsorshipDatePeriod,
  b: SponsorshipDatePeriod,
): boolean => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

const startViolationOf = (
  startsOn: string,
  today: BusinessDateString,
): PeriodViolations['startsOn'] => {
  if (!isCalendarDate(startsOn)) {
    return 'invalid';
  }
  if (startsOn < today) {
    return 'past';
  }
  return startsOn > addBusinessDays(today, SPONSORSHIP_MAX_LEAD_DAYS)
    ? 'too-far'
    : undefined;
};

const endViolationOf = (
  startsOn: string,
  endsOn: string,
): PeriodViolations['endsOn'] => {
  if (!isCalendarDate(endsOn)) {
    return 'invalid';
  }
  if (!isCalendarDate(startsOn)) {
    return undefined;
  }
  if (endsOn < startsOn) {
    return 'before-start';
  }
  return countBusinessDaysInclusive(startsOn, endsOn) > SPONSORSHIP_MAX_DAYS
    ? 'too-long'
    : undefined;
};

export const validatePeriod = (input: {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly today: BusinessDateString;
}): PeriodViolations => {
  const startsOn = startViolationOf(input.startsOn, input.today);
  const endsOn = endViolationOf(input.startsOn, input.endsOn);
  return {
    ...(startsOn === undefined ? {} : { startsOn }),
    ...(endsOn === undefined ? {} : { endsOn }),
  };
};

const overlapWithin = (
  period: SponsorshipDatePeriod,
  lower: BusinessDateString,
  upper: BusinessDateString,
): SponsorshipUnavailableRange | undefined => {
  const from = laterOf(period.startsOn, lower);
  const to = earlierOf(period.endsOn, upper);
  return from <= to ? { from, to, reason: 'overlap' } : undefined;
};

const isSelectableStart = (
  window: SponsorshipDateWindow,
  startsOn: BusinessDateString,
): boolean =>
  window.earliest <= startsOn &&
  startsOn <= window.latest &&
  window.unavailable.every(({ from, to }) => startsOn < from || to < startsOn);

const endWindowOf = (
  startsOn: BusinessDateString,
  periods: readonly SponsorshipDatePeriod[],
): SponsorshipDateWindow => {
  const maxEnd = addBusinessDays(startsOn, SPONSORSHIP_MAX_DAYS - 1);
  const next = periods.find((period) => period.startsOn > startsOn);
  if (next === undefined || next.startsOn > maxEnd) {
    return { earliest: startsOn, latest: maxEnd, unavailable: [] };
  }
  return {
    earliest: startsOn,
    latest: addBusinessDays(next.startsOn, -1),
    unavailable: [{ from: next.startsOn, to: maxEnd, reason: 'overlap' }],
  };
};

export const computePeriodWindows = (input: {
  readonly today: BusinessDateString;
  readonly startsOn: BusinessDateString | null;
  readonly paidPeriods: readonly SponsorshipDatePeriod[];
}): SponsorshipPeriodWindows => {
  const { today, startsOn } = input;
  if (startsOn !== null) {
    parseCalendarDate(startsOn);
  }
  const startLatest = addBusinessDays(today, SPONSORSHIP_MAX_LEAD_DAYS);
  const periods = input.paidPeriods
    .filter((period) => period.endsOn >= today)
    .toSorted((a, b) => (a.startsOn < b.startsOn ? -1 : 1));
  const start: SponsorshipDateWindow = {
    earliest: today,
    latest: startLatest,
    unavailable: periods.flatMap(
      (period) => overlapWithin(period, today, startLatest) ?? [],
    ),
  };
  if (startsOn === null || !isSelectableStart(start, startsOn)) {
    return { start, end: null };
  }
  return { start, end: endWindowOf(startsOn, periods) };
};
