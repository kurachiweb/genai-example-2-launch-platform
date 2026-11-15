export interface UtcDateTimeFormatOptions {
  readonly withYear?: boolean;
}

export function formatUtcDateTime(
  instant: Date,
  options: UtcDateTimeFormatOptions = {},
): string {
  assertValidInstant(instant);
  const hours = padTwoDigits(instant.getUTCHours());
  const minutes = padTwoDigits(instant.getUTCMinutes());
  return `${formatMonthDay(instant, options)}${hours}:${minutes}(UTC)`;
}

export function formatUtcDate(
  instant: Date,
  options: UtcDateTimeFormatOptions = {},
): string {
  assertValidInstant(instant);
  return `${formatMonthDay(instant, options)}(UTC)`;
}

function assertValidInstant(instant: Date): void {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError('無効な日時は表記できません');
  }
}

function formatMonthDay(
  instant: Date,
  { withYear = false }: UtcDateTimeFormatOptions,
): string {
  const year = withYear ? `${String(instant.getUTCFullYear())}年` : '';
  return `${year}${String(instant.getUTCMonth() + 1)}月${String(instant.getUTCDate())}日`;
}

function padTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
