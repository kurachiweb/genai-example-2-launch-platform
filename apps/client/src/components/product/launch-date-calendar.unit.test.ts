import { describe, expect, test } from 'bun:test';

import type { LaunchDateWindowView } from '../../graphql/my-products.ts';
import {
  businessDateOfCalendarDay,
  calendarDayOf,
  unavailableReasonOn,
} from './launch-date-calendar.ts';

const WINDOW: LaunchDateWindowView = {
  earliest: '2026-11-16',
  latest: '2027-02-07',
  unavailable: [
    { from: '2026-11-09', to: '2026-11-10', reason: 'pairing_deadline' },
    { from: '2026-11-11', to: '2026-11-15', reason: 'relaunch_interval' },
    { from: '2027-02-08', to: '2027-02-08', reason: 'out_of_range' },
  ],
  relaunchIntervalDays: 7,
};

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

describe('unavailableReasonOn', () => {
  test('選べない範囲(両端を含む)の日は、その範囲の理由を返す', () => {
    expect(unavailableReasonOn(WINDOW, '2026-11-09')).toBe('pairing_deadline');
    expect(unavailableReasonOn(WINDOW, '2026-11-10')).toBe('pairing_deadline');
    expect(unavailableReasonOn(WINDOW, '2026-11-11')).toBe('relaunch_interval');
    expect(unavailableReasonOn(WINDOW, '2026-11-15')).toBe('relaunch_interval');
    expect(unavailableReasonOn(WINDOW, '2027-02-08')).toBe('out_of_range');
  });

  test('最も早い日から最も遅い日までの範囲外の日は、前ならペアリングの締め切り、後なら選べる期間の外とする', () => {
    expect(unavailableReasonOn(WINDOW, '2026-11-01')).toBe('pairing_deadline');
    expect(unavailableReasonOn(WINDOW, '2027-03-01')).toBe('out_of_range');
  });

  test('選べる日はundefinedを返す', () => {
    expect(unavailableReasonOn(WINDOW, '2026-11-16')).toBeUndefined();
    expect(unavailableReasonOn(WINDOW, '2027-02-07')).toBeUndefined();
  });
});
