import { describe, expect, test } from 'bun:test';

import { formatBusinessDateLabel } from './business-date-label.ts';

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
