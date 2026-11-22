import { describe, expect, test } from 'bun:test';

import { toBusinessDate, toIsoUtc, toIsoUtcOrNull } from './export-formats.ts';

describe('toIsoUtc', () => {
  test('ミリ秒付きのISO 8601のUTC表記にする', () => {
    expect(toIsoUtc(new Date('2026-09-07T08:00:00.000Z'))).toBe(
      '2026-09-07T08:00:00.000Z',
    );
  });

  test('ミリ秒が0でも省略しない', () => {
    expect(toIsoUtc(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });

  test('ミリ秒の端数を保つ', () => {
    expect(toIsoUtc(new Date('2026-09-15T10:12:30.007Z'))).toBe(
      '2026-09-15T10:12:30.007Z',
    );
  });

  test('不正な日時は例外にする', () => {
    expect(() => toIsoUtc(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('toIsoUtcOrNull', () => {
  test('nullはnullのまま返す', () => {
    expect(toIsoUtcOrNull(null)).toBeNull();
  });

  test('日時はミリ秒付きのUTC表記にする', () => {
    expect(toIsoUtcOrNull(new Date('2026-03-02T01:15:00Z'))).toBe(
      '2026-03-02T01:15:00.000Z',
    );
  });
});

describe('toBusinessDate', () => {
  test.each([
    ['2026-09-07T07:59:59.999Z', '2026-09-06'],
    ['2026-09-07T08:00:00.000Z', '2026-09-07'],
    ['2026-09-07T23:59:59.999Z', '2026-09-07'],
    ['2026-09-08T07:59:59.999Z', '2026-09-07'],
    ['2026-09-08T08:00:00.000Z', '2026-09-08'],
  ])('%sの基準時刻の日付は%sである', (instant, expected) => {
    expect(toBusinessDate(new Date(instant))).toBe(expected);
  });

  test('UTCの8:00の前は前日の日付になる年またぎの境界を扱う', () => {
    expect(toBusinessDate(new Date('2027-01-01T07:59:59.999Z'))).toBe(
      '2026-12-31',
    );
    expect(toBusinessDate(new Date('2027-01-01T08:00:00.000Z'))).toBe(
      '2027-01-01',
    );
  });

  test('不正な日時は例外にする', () => {
    expect(() => toBusinessDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});
