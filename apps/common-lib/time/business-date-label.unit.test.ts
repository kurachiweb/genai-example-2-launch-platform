import { describe, expect, test } from 'bun:test';

import {
  formatBusinessDateLabel,
  formatBusinessDateWithWeekdayLabel,
} from './business-date-label.ts';

describe('formatBusinessDateLabel', () => {
  test('今年の業務日付は年を省いて月日だけを示す', () => {
    expect(formatBusinessDateLabel('2026-09-15', 2026)).toBe('9月15日');
    expect(formatBusinessDateLabel('2026-12-31', 2026)).toBe('12月31日');
  });

  test('今年でない業務日付は年を付ける', () => {
    expect(formatBusinessDateLabel('2025-09-15', 2026)).toBe('2025年9月15日');
    expect(formatBusinessDateLabel('2027-01-05', 2026)).toBe('2027年1月5日');
  });

  test('月と日の先頭の0を除いて示す', () => {
    expect(formatBusinessDateLabel('2026-01-01', 2026)).toBe('1月1日');
  });

  test('YYYY-MM-DDの形でない値はRangeErrorにする', () => {
    expect(() => formatBusinessDateLabel('2026-9-15', 2026)).toThrow(
      RangeError,
    );
    expect(() => formatBusinessDateLabel('2026-09-15T00:00:00Z', 2026)).toThrow(
      RangeError,
    );
    expect(() => formatBusinessDateLabel('', 2026)).toThrow(RangeError);
  });
});

describe('formatBusinessDateWithWeekdayLabel', () => {
  test.each([
    { date: '2027-05-30', expected: '2027年5月30日(日)' },
    { date: '2028-01-03', expected: '2028年1月3日(月)' },
    { date: '2027-03-02', expected: '2027年3月2日(火)' },
    { date: '2027-06-02', expected: '2027年6月2日(水)' },
    { date: '2027-06-03', expected: '2027年6月3日(木)' },
    { date: '2027-06-04', expected: '2027年6月4日(金)' },
    { date: '2027-12-25', expected: '2027年12月25日(土)' },
  ])('$dateを年・月日・曜日つきで示す', ({ date, expected }) => {
    expect(formatBusinessDateWithWeekdayLabel(date)).toBe(expected);
  });

  test('今年の業務日付でも年を省かない', () => {
    expect(formatBusinessDateWithWeekdayLabel('2026-05-31')).toBe(
      '2026年5月31日(日)',
    );
  });

  test('月と日の先頭の0を除いて示す', () => {
    expect(formatBusinessDateWithWeekdayLabel('2029-01-07')).toBe(
      '2029年1月7日(日)',
    );
  });

  test('うるう日の曜日を暦日から求める', () => {
    expect(formatBusinessDateWithWeekdayLabel('2028-02-29')).toBe(
      '2028年2月29日(火)',
    );
  });

  test('YYYY-MM-DDの形でない値はRangeErrorにする', () => {
    expect(() => formatBusinessDateWithWeekdayLabel('2027-5-30')).toThrow(
      RangeError,
    );
    expect(() =>
      formatBusinessDateWithWeekdayLabel('2027-05-30T00:00:00Z'),
    ).toThrow(RangeError);
    expect(() => formatBusinessDateWithWeekdayLabel('')).toThrow(RangeError);
  });
});
