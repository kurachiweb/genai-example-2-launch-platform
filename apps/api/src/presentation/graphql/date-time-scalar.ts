import { GraphQLScalarType, Kind, type ValueNode } from 'graphql';

import { AppError } from '../../../lib/core/errors/app-error.ts';

export const DATE_TIME_SCALAR_NAME = 'DateTime';
export const DATE_TIME_DESCRIPTION = 'UTCのRFC 3339形式の日時';

const RFC_3339_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})t(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d+))?(?:z|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/iu;

const MAX_YEAR = 9999;
const MILLISECONDS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const FEBRUARY = 2;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === FEBRUARY && isLeapYear(year)) {
    return 29;
  }
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

function isWithin(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

function isRepresentableYear(date: Date): boolean {
  return (
    !Number.isNaN(date.getTime()) &&
    isWithin(date.getUTCFullYear(), 0, MAX_YEAR)
  );
}

function invalidDateTime(): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: '日時はオフセット付きのRFC 3339形式の文字列で指定してください。',
  });
}

interface DateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly offsetHour: number;
  readonly offsetMinute: number;
}

function toParts(groups: Record<string, string | undefined>): DateTimeParts {
  return {
    year: Number(groups.year),
    month: Number(groups.month),
    day: Number(groups.day),
    hour: Number(groups.hour),
    minute: Number(groups.minute),
    second: Number(groups.second),
    offsetHour: Number(groups.offsetHour ?? 0),
    offsetMinute: Number(groups.offsetMinute ?? 0),
  };
}

function isValidParts(parts: DateTimeParts): boolean {
  return (
    isWithin(parts.month, 1, 12) &&
    isWithin(parts.day, 1, daysInMonth(parts.year, parts.month)) &&
    isWithin(parts.hour, 0, 23) &&
    isWithin(parts.minute, 0, 59) &&
    isWithin(parts.second, 0, 59) &&
    isWithin(parts.offsetHour, 0, 23) &&
    isWithin(parts.offsetMinute, 0, 59)
  );
}

function parseRfc3339(text: string): number {
  const groups = RFC_3339_PATTERN.exec(text)?.groups;
  if (groups === undefined) {
    throw invalidDateTime();
  }
  const parts = toParts(groups);
  if (!isValidParts(parts)) {
    throw invalidDateTime();
  }
  // Date.UTCは0〜99年を1900年代として扱うため、検証済みの値をISO形式に組み直して解釈する
  const milliseconds = (groups.fraction ?? '').padEnd(3, '0').slice(0, 3);
  const localText = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${milliseconds}Z`;
  const offsetMinutes =
    (parts.offsetHour * MINUTES_PER_HOUR + parts.offsetMinute) *
    (groups.sign === '-' ? -1 : 1);
  const epochMilliseconds =
    Date.parse(localText) - offsetMinutes * MILLISECONDS_PER_MINUTE;
  if (!isRepresentableYear(new Date(epochMilliseconds))) {
    throw invalidDateTime();
  }
  return epochMilliseconds;
}

function parseDateTimeInput(value: unknown): number {
  if (typeof value !== 'string') {
    throw invalidDateTime();
  }
  return parseRfc3339(value);
}

function toOutputDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return new Date(value);
  }
  return undefined;
}

function serializeDateTime(value: unknown): string {
  const date = toOutputDate(value);
  if (date === undefined || !isRepresentableYear(date)) {
    throw new TypeError(
      'DateTimeはエポックミリ秒の整数または0〜9999年のDateだけを出力できます。',
    );
  }
  return date.toISOString();
}

function parseDateTimeLiteral(ast: ValueNode): number {
  if (ast.kind !== Kind.STRING) {
    throw invalidDateTime();
  }
  return parseRfc3339(ast.value);
}

export const dateTimeScalar = new GraphQLScalarType<number, string>({
  name: DATE_TIME_SCALAR_NAME,
  description: DATE_TIME_DESCRIPTION,
  serialize: serializeDateTime,
  parseValue: parseDateTimeInput,
  parseLiteral: parseDateTimeLiteral,
});
