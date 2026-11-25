import { describe, expect, test } from 'bun:test';

import {
  businessDateOfCalendarDay,
  calendarDayOf,
} from './business-date-calendar.ts';

describe('calendarDayOf・businessDateOfCalendarDay', () => {
  test('業務日付を同じ暦日の閲覧者のローカルの0:00にし、戻すと同じ業務日付になる', () => {
    const day = calendarDayOf('2026-11-20');

    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([
      2026, 10, 20,
    ]);
    expect([day.getHours(), day.getMinutes()]).toEqual([0, 0]);
    expect(businessDateOfCalendarDay(day)).toBe('2026-11-20');
  });

  test('月と日を2桁にそろえる', () => {
    expect(businessDateOfCalendarDay(new Date(2027, 0, 5))).toBe('2027-01-05');
  });
});
