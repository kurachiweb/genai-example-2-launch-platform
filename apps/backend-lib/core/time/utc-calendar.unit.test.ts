import { describe, expect, test } from 'bun:test';

import { utcYearsBefore } from './utc-calendar.ts';

describe('utcYearsBefore', () => {
  test.each([
    ['2026-11-22T12:21:00.000Z', 3, '2023-11-22T12:21:00.000Z'],
    ['2026-11-22T12:21:00.000Z', 7, '2019-11-22T12:21:00.000Z'],
    ['2028-02-29T12:21:00.456Z', 3, '2025-02-28T12:21:00.456Z'],
    ['2028-02-29T12:21:00.456Z', 4, '2024-02-29T12:21:00.456Z'],
    ['2027-03-01T00:00:00.000Z', 3, '2024-03-01T00:00:00.000Z'],
    ['2027-12-31T23:59:59.999Z', 3, '2024-12-31T23:59:59.999Z'],
  ])(
    '%sのUTCの暦の%i年前は%sで、同じ日が無ければ月末へ寄せる',
    (time, years, expected) => {
      expect(utcYearsBefore(new Date(time), years)).toEqual(new Date(expected));
    },
  );

  test('元の日時を変えない', () => {
    const time = new Date('2026-11-22T12:21:00.000Z');

    utcYearsBefore(time, 3);

    expect(time).toEqual(new Date('2026-11-22T12:21:00.000Z'));
  });
});
