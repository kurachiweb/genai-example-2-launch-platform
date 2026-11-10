export type BusinessDateString = string;

export const PERIOD_PRESETS = Object.freeze([
  'yesterday',
  'week',
  'month',
  'year',
  'all',
] as const);

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface PeriodRange {
  readonly from?: BusinessDateString | undefined;
  readonly to?: BusinessDateString | undefined;
}

export interface CustomRangeErrors {
  readonly from?: 'future';
  readonly to?: 'future';
  readonly order?: 'reversed';
}

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const BUSINESS_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

const MONTHS_IN_YEAR = 12;

const DAYS_IN_WEEK = 7;

const MONDAY_OFFSET = 6;

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const DAYS_IN_MONTHS_OF_COMMON_YEAR = Object.freeze([
  31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
]);

const daysInMonth = (year: number, month: number): number =>
  month === 2 && isLeapYear(year)
    ? 29
    : (DAYS_IN_MONTHS_OF_COMMON_YEAR[month - 1] ?? 0);

const partsOf = (value: string): DateParts | undefined => {
  const groups = BUSINESS_DATE_PATTERN.exec(value)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const parts = {
    year: Number(groups.year),
    month: Number(groups.month),
    day: Number(groups.day),
  };
  const isRealDate =
    parts.year >= 1 &&
    parts.month >= 1 &&
    parts.month <= MONTHS_IN_YEAR &&
    parts.day >= 1 &&
    parts.day <= daysInMonth(parts.year, parts.month);
  return isRealDate ? parts : undefined;
};

export const isBusinessDateString = (
  value: unknown,
): value is BusinessDateString =>
  typeof value === 'string' && partsOf(value) !== undefined;

const requireParts = (value: string): DateParts => {
  const parts = partsOf(value);
  if (parts === undefined) {
    throw new RangeError(`業務日付の形でない値です: ${value}`);
  }
  return parts;
};

const formatParts = ({ year, month, day }: DateParts): BusinessDateString =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

// Date.UTCは0〜99年を1900年代として扱うため、setUTCFullYearで年をそのまま指定する
const toUtcDate = ({ year, month, day }: DateParts): Date => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
};

const addDays = (parts: DateParts, days: number): DateParts => {
  const date = toUtcDate(parts);
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const rangeOf = (from: DateParts, to: DateParts): PeriodRange => ({
  from: formatParts(from),
  to: formatParts(to),
});

export const presetRange = (
  preset: PeriodPreset,
  today: BusinessDateString,
): PeriodRange => {
  const parts = requireParts(today);
  switch (preset) {
    case 'yesterday': {
      const yesterday = addDays(parts, -1);
      return rangeOf(yesterday, yesterday);
    }
    case 'week': {
      const monday = addDays(
        parts,
        -((toUtcDate(parts).getUTCDay() + MONDAY_OFFSET) % DAYS_IN_WEEK),
      );
      return rangeOf(monday, addDays(monday, DAYS_IN_WEEK - 1));
    }
    case 'month':
      return rangeOf(
        { ...parts, day: 1 },
        { ...parts, day: daysInMonth(parts.year, parts.month) },
      );
    case 'year':
      return rangeOf(
        { year: parts.year, month: 1, day: 1 },
        { year: parts.year, month: MONTHS_IN_YEAR, day: 31 },
      );
    case 'all':
      return {};
  }
};

export const periodKeyOf = (
  range: PeriodRange,
  today: BusinessDateString,
): PeriodPreset | 'custom' =>
  PERIOD_PRESETS.find((preset) => {
    const presetValue = presetRange(preset, today);
    return presetValue.from === range.from && presetValue.to === range.to;
  }) ?? 'custom';

const presentDate = (value: string | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : value;

// 業務日付の文字列は桁を揃えた形のため、文字列の大小が日付の前後と一致する
export const validateCustomRange = (input: {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly today: BusinessDateString;
}): CustomRangeErrors => {
  const from = presentDate(input.from);
  const to = presentDate(input.to);
  return {
    ...(from !== undefined && from > input.today ? { from: 'future' } : {}),
    ...(to !== undefined && to > input.today ? { to: 'future' } : {}),
    ...(from !== undefined && to !== undefined && from > to
      ? { order: 'reversed' }
      : {}),
  };
};

// 文言規則の日付の示し方: 今年なら月日だけ、今年でなければ年を付ける
const formatDateLabel = (value: string, currentYear: number): string => {
  const { year, month, day } = requireParts(value);
  const monthDay = `${String(month)}月${String(day)}日`;
  return year === currentYear ? monthDay : `${String(year)}年${monthDay}`;
};

export const formatPeriodLabel = (
  range: PeriodRange,
  today: BusinessDateString,
): string => {
  const currentYear = requireParts(today).year;
  const { from, to } = range;
  if (from !== undefined && to !== undefined) {
    const fromLabel = formatDateLabel(from, currentYear);
    return from === to
      ? fromLabel
      : `${fromLabel}〜${formatDateLabel(to, currentYear)}`;
  }
  if (from !== undefined) {
    return `${formatDateLabel(from, currentYear)}以降`;
  }
  if (to !== undefined) {
    return `${formatDateLabel(to, currentYear)}以前`;
  }
  return '全期間';
};
