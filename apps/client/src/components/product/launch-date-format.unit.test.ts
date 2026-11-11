import { describe, expect, test } from 'bun:test';

import { yearInTimeZone } from './launch-date-format.ts';

describe('yearInTimeZone', () => {
  test('時点の年を指定のタイムゾーンの暦で求める', () => {
    const newYearInTokyo = new Date('2026-12-31T15:30:00.000Z');

    expect(yearInTimeZone(newYearInTokyo, 'Asia/Tokyo')).toBe(2027);
    expect(yearInTimeZone(newYearInTokyo, 'America/Los_Angeles')).toBe(2026);
  });
});
