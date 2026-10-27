import { describe, expect, test } from 'bun:test';

import { formatUtcDate, formatUtcDateTime } from './format-utc-date-time.ts';

describe('formatUtcDateTime', () => {
  test('UTCの月日と時分を「9月15日07:40(UTC)」の形式で表す', () => {
    expect(formatUtcDateTime(new Date('2026-09-15T07:40:00.000Z'))).toBe(
      '9月15日07:40(UTC)',
    );
  });

  test.each([
    ['2026-01-05T09:03:00.000Z', '1月5日09:03(UTC)'],
    ['2026-10-01T00:00:00.000Z', '10月1日00:00(UTC)'],
    ['2026-12-31T23:59:00.000Z', '12月31日23:59(UTC)'],
  ])('月日はゼロ埋めせず時分は2桁で表す(%s)', (iso, expected) => {
    expect(formatUtcDateTime(new Date(iso))).toBe(expected);
  });

  test('秒以下を切り捨てて分までを表す', () => {
    expect(formatUtcDateTime(new Date('2026-09-15T07:40:59.999Z'))).toBe(
      '9月15日07:40(UTC)',
    );
  });

  test.each([
    ['2026-09-14T23:59:59.999Z', '9月14日23:59(UTC)'],
    ['2026-09-15T00:00:00.000Z', '9月15日00:00(UTC)'],
    ['2026-09-14T15:00:00.000Z', '9月14日15:00(UTC)'],
  ])('UTCの日付の境界で日付を切り替える(%s)', (iso, expected) => {
    expect(formatUtcDateTime(new Date(iso))).toBe(expected);
  });

  test('年付きの形式では「2026年9月15日07:40(UTC)」の形式で表す', () => {
    expect(
      formatUtcDateTime(new Date('2026-09-15T07:40:00.000Z'), {
        withYear: true,
      }),
    ).toBe('2026年9月15日07:40(UTC)');
  });

  test.each([
    ['2026-12-31T23:59:59.999Z', '2026年12月31日23:59(UTC)'],
    ['2027-01-01T00:00:00.000Z', '2027年1月1日00:00(UTC)'],
  ])('年付きの形式ではUTCの年の境界で年を切り替える(%s)', (iso, expected) => {
    expect(formatUtcDateTime(new Date(iso), { withYear: true })).toBe(expected);
  });

  test('年付きを指定しない場合は年を含めない', () => {
    expect(
      formatUtcDateTime(new Date('2026-09-15T07:40:00.000Z'), {
        withYear: false,
      }),
    ).toBe('9月15日07:40(UTC)');
  });

  test('無効な日時は表記せずRangeErrorにする', () => {
    expect(() => formatUtcDateTime(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('formatUtcDate', () => {
  test('UTCの月日を「9月15日(UTC)」の形式で表す', () => {
    expect(formatUtcDate(new Date('2026-09-15T07:40:00.000Z'))).toBe(
      '9月15日(UTC)',
    );
  });

  test('月日はゼロ埋めしない', () => {
    expect(formatUtcDate(new Date('2026-01-05T09:03:00.000Z'))).toBe(
      '1月5日(UTC)',
    );
  });

  test.each([
    ['2026-09-14T23:59:59.999Z', '9月14日(UTC)'],
    ['2026-09-15T00:00:00.000Z', '9月15日(UTC)'],
  ])('UTCの日付の境界で日付を切り替える(%s)', (iso, expected) => {
    expect(formatUtcDate(new Date(iso))).toBe(expected);
  });

  test.each([
    ['2026-12-31T23:59:59.999Z', '2026年12月31日(UTC)'],
    ['2027-01-01T00:00:00.000Z', '2027年1月1日(UTC)'],
  ])('年付きの形式では年を含めて表す(%s)', (iso, expected) => {
    expect(formatUtcDate(new Date(iso), { withYear: true })).toBe(expected);
  });

  test('無効な日時は表記せずRangeErrorにする', () => {
    expect(() => formatUtcDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});
