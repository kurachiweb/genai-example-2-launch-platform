import { describe, expect, test } from 'bun:test';

import { formatLaunchDate, yearInTimeZone } from './launch-date-format.ts';

describe('formatLaunchDate', () => {
  test('今年のローンチ日は月日だけを示す', () => {
    expect(formatLaunchDate('2026-09-28', 2026)).toBe('9月28日');
  });

  test('今年でないローンチ日は年を付ける', () => {
    expect(formatLaunchDate('2027-01-05', 2026)).toBe('2027年1月5日');
    expect(formatLaunchDate('2025-12-31', 2026)).toBe('2025年12月31日');
  });

  test('業務日付の形でない値はRangeErrorにする', () => {
    expect(() => formatLaunchDate('2026-9-28', 2026)).toThrow(RangeError);
    expect(() => formatLaunchDate('2026-09-28T00:00:00Z', 2026)).toThrow(
      RangeError,
    );
  });
});

describe('yearInTimeZone', () => {
  test('時点の年を指定のタイムゾーンの暦で求める', () => {
    const newYearInTokyo = new Date('2026-12-31T15:30:00.000Z');

    expect(yearInTimeZone(newYearInTokyo, 'Asia/Tokyo')).toBe(2027);
    expect(yearInTimeZone(newYearInTokyo, 'America/Los_Angeles')).toBe(2026);
  });
});
