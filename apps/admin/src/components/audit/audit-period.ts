export interface AuditPeriodInput {
  readonly from?: string;
  readonly to?: string;
}

export interface AuditPeriod {
  // この時刻を含む
  readonly occurredFrom?: string;
  // この時刻を含まない
  readonly occurredBefore?: string;
}

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

// APIの日時は西暦4桁(0000〜9999年)だけを受け付けるため、地域の時差(UTC-12〜UTC+14)と終了日の翌日への繰り上げを加えても境界の時刻がその範囲に収まる年だけを受け付ける
export const AUDIT_PERIOD_MIN_DATE = '0001-01-01';

export const AUDIT_PERIOD_MAX_DATE = '9998-12-31';

const MIN_YEAR = 1;

const MAX_YEAR = 9998;

const DAY_MS = 24 * 60 * 60 * 1000;

const parseCalendarDate = (value: string): CalendarDate | undefined => {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (match === null) {
    return undefined;
  }
  const [, year, month, day] = match.map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    year < MIN_YEAR ||
    year > MAX_YEAR
  ) {
    return undefined;
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? { year, month, day }
    : undefined;
};

export const isCalendarDate = (value: string): boolean =>
  parseCalendarDate(value) !== undefined;

// Date.UTCは0〜99年を1900年代とみなすため、setUTCFullYearで組み立てる
const wallClockAsUtc = ({ year, month, day }: CalendarDate): number => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
};

const formatterOf = (timeZone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
    era: 'short',
  });

// その時刻の地域の暦の日時を、UTCの日時とみなした時刻にする
const localWallClockOf = (
  formatter: Intl.DateTimeFormat,
  instant: number,
): number => {
  const parts = new Map(
    formatter
      .formatToParts(new Date(instant))
      .map(({ type, value }) => [type, value]),
  );
  const numberOf = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.get(type));
  const year =
    parts.get('era') === 'BC' ? 1 - numberOf('year') : numberOf('year');
  const date = new Date(0);
  date.setUTCFullYear(year, numberOf('month') - 1, numberOf('day'));
  date.setUTCHours(numberOf('hour'), numberOf('minute'), numberOf('second'));
  return date.getTime();
};

// 地域の暦でその日に属する最も早い時刻。夏時間の切り替えで0時が無い日や0時が2度ある日があるため、前後の日の時差から候補を作り、地域の暦でその日の0時以降になる最も早い候補を選ぶ
const startOfDay = (date: CalendarDate, timeZone: string): number => {
  const formatter = formatterOf(timeZone);
  const wall = wallClockAsUtc(date);
  const offsets = new Set(
    [wall - DAY_MS, wall, wall + DAY_MS].map(
      (instant) => localWallClockOf(formatter, instant) - instant,
    ),
  );
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter(
      (instant) =>
        localWallClockOf(formatter, instant) >= wall &&
        localWallClockOf(formatter, instant) < wall + DAY_MS,
    );
  return candidates.length === 0
    ? wall - (localWallClockOf(formatter, wall) - wall)
    : Math.min(...candidates);
};

const nextDayOf = (date: CalendarDate): CalendarDate => {
  const next = new Date(wallClockAsUtc(date) + DAY_MS);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
};

// 入力の日付(閲覧者の地域の暦)を、開始日の0時を含み終了日の翌日0時を含まないUTCの時刻の範囲にする
export function toAuditPeriod(
  { from, to }: AuditPeriodInput,
  timeZone: string,
): AuditPeriod {
  const start = from === undefined ? undefined : parseCalendarDate(from);
  const end = to === undefined ? undefined : parseCalendarDate(to);
  return {
    ...(start !== undefined && {
      occurredFrom: new Date(startOfDay(start, timeZone)).toISOString(),
    }),
    ...(end !== undefined && {
      occurredBefore: new Date(
        startOfDay(nextDayOf(end), timeZone),
      ).toISOString(),
    }),
  };
}

export type AuditPeriodFieldError = 'out-of-range' | 'reversed';

export interface AuditPeriodInputErrors {
  readonly from?: AuditPeriodFieldError;
  readonly to?: AuditPeriodFieldError;
}

// 入力欄の値(空は未指定)を検証する。type="date"の欄はブラウザが年月日の形にした値か空を渡すため、形の誤りも範囲の外として示す
export function checkAuditPeriodInput({
  from = '',
  to = '',
}: AuditPeriodInput): AuditPeriodInputErrors {
  const fromValid = from === '' || isCalendarDate(from);
  const toValid = to === '' || isCalendarDate(to);
  // 年月日の文字列は辞書順が日付の順と一致する
  const reversed =
    fromValid && toValid && from !== '' && to !== '' && to < from;
  return {
    ...(!fromValid && { from: 'out-of-range' }),
    ...(!toValid && { to: 'out-of-range' }),
    ...(reversed && { to: 'reversed' }),
  };
}
