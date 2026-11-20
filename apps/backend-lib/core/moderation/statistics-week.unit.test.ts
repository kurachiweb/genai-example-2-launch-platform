import { describe, expect, test } from 'bun:test';

import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../time/business-time.ts';
import {
  isWeekFinished,
  lastDayOf,
  previousWeek,
  type StatisticsWeekRange,
  weekOf,
  weeksToCompute,
} from './statistics-week.ts';

function date(value: string): BusinessDate {
  return parseBusinessDate(value);
}

function at(value: string, clock: string): Date {
  const [hour = 0, minute = 0] = clock.split(':').map(Number);
  return fromBusinessDateTime(date(value), { hour, minute });
}

function rangeOf(
  weekStart: string,
  nextWeekStart: string,
): StatisticsWeekRange {
  return {
    weekStart: date(weekStart),
    from: at(weekStart, '00:00'),
    to: at(nextWeekStart, '00:00'),
  };
}

describe('weekOf', () => {
  test('月曜日0:00はその月曜日に始まる週に入る', () => {
    expect(weekOf(at('2026-11-16', '00:00'))).toEqual(
      rangeOf('2026-11-16', '2026-11-23'),
    );
  });

  test('月曜日0:00の直前は前の週に入る', () => {
    expect(weekOf(new Date(at('2026-11-16', '00:00').getTime() - 1))).toEqual(
      rangeOf('2026-11-09', '2026-11-16'),
    );
  });

  test('日曜日23:59は6日前の月曜日に始まる週に入る', () => {
    expect(weekOf(at('2026-11-22', '23:59'))).toEqual(
      rangeOf('2026-11-16', '2026-11-23'),
    );
  });

  test('週の範囲は業務時刻の月曜日0:00(UTCの月曜日8:00)から翌週の月曜日0:00までである', () => {
    const week = weekOf(at('2026-11-20', '12:00'));

    expect([week.from.toISOString(), week.to.toISOString()]).toEqual([
      '2026-11-16T08:00:00.000Z',
      '2026-11-23T08:00:00.000Z',
    ]);
  });

  test('UTCで月曜日になっていても業務時刻で日曜日なら前の週に入る', () => {
    expect(weekOf(new Date('2026-11-16T07:59:59.999Z')).weekStart).toBe(
      date('2026-11-09'),
    );
  });

  test('年をまたぐ週は前の年の月曜日に始まり翌年の月曜日に終わる', () => {
    const expected = rangeOf('2026-12-28', '2027-01-04');

    expect(weekOf(at('2026-12-31', '12:00'))).toEqual(expected);
    expect(weekOf(at('2027-01-03', '23:59'))).toEqual(expected);
  });

  test('不正な時点は週に変換できない', () => {
    expect(() => weekOf(new Date(Number.NaN))).toThrow(RangeError);
  });

  test('返す週は実行時に書き換えられない', () => {
    expect(Object.isFrozen(weekOf(at('2026-11-20', '12:00')))).toBe(true);
  });
});

describe('previousWeek', () => {
  test('前週は7日前の月曜日に始まり、その週の始まりで終わる', () => {
    expect(previousWeek(rangeOf('2026-11-16', '2026-11-23'))).toEqual(
      rangeOf('2026-11-09', '2026-11-16'),
    );
  });

  test('年の初めの週の前週は前の年の最後の週である', () => {
    expect(previousWeek(rangeOf('2027-01-04', '2027-01-11'))).toEqual(
      rangeOf('2026-12-28', '2027-01-04'),
    );
  });

  test('返す週は実行時に書き換えられない', () => {
    expect(
      Object.isFrozen(previousWeek(rangeOf('2026-11-16', '2026-11-23'))),
    ).toBe(true);
  });
});

describe('weeksToCompute', () => {
  test('実行時刻の週を今週、その前の週を前週として返す', () => {
    expect(weeksToCompute(at('2026-11-17', '04:21'))).toEqual({
      current: rangeOf('2026-11-16', '2026-11-23'),
      previous: rangeOf('2026-11-09', '2026-11-16'),
    });
  });

  test('月曜日の4:21の実行では、終わったばかりの週が前週になる', () => {
    const { current, previous } = weeksToCompute(at('2026-11-23', '04:21'));

    expect([current.weekStart, previous.weekStart]).toEqual([
      date('2026-11-23'),
      date('2026-11-16'),
    ]);
  });

  test('年の初めの週の実行では前の年の最後の週が前週になる', () => {
    expect(weeksToCompute(at('2027-01-04', '04:21'))).toEqual({
      current: rangeOf('2027-01-04', '2027-01-11'),
      previous: rangeOf('2026-12-28', '2027-01-04'),
    });
  });

  test('返す組は実行時に書き換えられない', () => {
    expect(Object.isFrozen(weeksToCompute(at('2026-11-17', '04:21')))).toBe(
      true,
    );
  });
});

describe('isWeekFinished', () => {
  const week = rangeOf('2026-11-16', '2026-11-23');

  test('翌週の月曜日0:00の直前は週が終わっていない', () => {
    expect(isWeekFinished(week, new Date(week.to.getTime() - 1))).toBe(false);
  });

  test('翌週の月曜日0:00ちょうどに週が終わる', () => {
    expect(isWeekFinished(week, at('2026-11-23', '00:00'))).toBe(true);
  });

  test('翌週の月曜日0:00より後は週が終わっている', () => {
    expect(isWeekFinished(week, at('2026-11-23', '04:21'))).toBe(true);
  });

  test('週の始まりの時点では週が終わっていない', () => {
    expect(isWeekFinished(week, week.from)).toBe(false);
  });
});

describe('lastDayOf', () => {
  test('週の最後の日はその週の日曜日である', () => {
    expect(lastDayOf(rangeOf('2026-11-16', '2026-11-23'))).toBe(
      date('2026-11-22'),
    );
  });

  test('年をまたぐ週の最後の日は翌年の日曜日である', () => {
    expect(lastDayOf(rangeOf('2026-12-28', '2027-01-04'))).toBe(
      date('2027-01-03'),
    );
  });
});
