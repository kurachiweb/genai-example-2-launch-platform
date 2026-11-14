import { describe, expect, test } from 'bun:test';

import {
  BUSINESS_UTC_OFFSET_MINUTES,
  businessWeekOf,
  fromBusinessDateTime,
  parseBusinessDate,
  toBusinessDateTime,
  toUtcCronExpression,
} from './business-time.ts';

describe('BUSINESS_UTC_OFFSET_MINUTES', () => {
  test('業務時刻のUTCからのオフセットは-480分である', () => {
    expect(BUSINESS_UTC_OFFSET_MINUTES).toBe(-480);
  });
});

describe('toBusinessDateTime', () => {
  test('UTCの7:59は前日の業務日付の23:59になる', () => {
    const result = toBusinessDateTime(new Date('2026-10-26T07:59:59.999Z'));

    expect(result).toEqual({
      date: parseBusinessDate('2026-10-25'),
      weekday: 7,
      hour: 23,
      minute: 59,
    });
  });

  test('UTCの8:00ちょうどは新しい業務日付の0:00になる', () => {
    const result = toBusinessDateTime(new Date('2026-10-26T08:00:00.000Z'));

    expect(result).toEqual({
      date: parseBusinessDate('2026-10-26'),
      weekday: 1,
      hour: 0,
      minute: 0,
    });
  });

  test('米国の夏時間の期間でも夏時間の補正をせずUTCの8:00を日境界にする', () => {
    expect(toBusinessDateTime(new Date('2026-07-01T07:59:00.000Z'))).toEqual({
      date: parseBusinessDate('2026-06-30'),
      weekday: 2,
      hour: 23,
      minute: 59,
    });
    expect(toBusinessDateTime(new Date('2026-07-01T08:00:00.000Z'))).toEqual({
      date: parseBusinessDate('2026-07-01'),
      weekday: 3,
      hour: 0,
      minute: 0,
    });
  });

  test('UTCの日付をまたぐ時点を業務時刻の当日の夜に変換する', () => {
    const result = toBusinessDateTime(new Date('2027-01-01T07:45:30.000Z'));

    expect(result).toEqual({
      date: parseBusinessDate('2026-12-31'),
      weekday: 4,
      hour: 23,
      minute: 45,
    });
  });

  test('不正な時点を例外にする', () => {
    expect(() => toBusinessDateTime(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('fromBusinessDateTime', () => {
  test('業務日付の0:00はUTCの同じ日の8:00になる', () => {
    const result = fromBusinessDateTime(parseBusinessDate('2026-10-26'), {
      hour: 0,
      minute: 0,
    });

    expect(result.toISOString()).toBe('2026-10-26T08:00:00.000Z');
  });

  test('業務日付の23:45はUTCの翌日の7:45になる', () => {
    const result = fromBusinessDateTime(parseBusinessDate('2026-12-31'), {
      hour: 23,
      minute: 45,
    });

    expect(result.toISOString()).toBe('2027-01-01T07:45:00.000Z');
  });

  test('夏時間の期間でも補正をしない', () => {
    const result = fromBusinessDateTime(parseBusinessDate('2026-07-01'), {
      hour: 4,
      minute: 21,
    });

    expect(result.toISOString()).toBe('2026-07-01T12:21:00.000Z');
  });

  test('toBusinessDateTimeの結果から元の時点(分の精度)に戻る', () => {
    const instant = new Date('2028-02-29T03:17:00.000Z');
    const business = toBusinessDateTime(instant);

    expect(business.date).toBe(parseBusinessDate('2028-02-28'));
    expect(fromBusinessDateTime(business.date, business)).toEqual(instant);
  });

  test.each([
    { hour: 24, minute: 0 },
    { hour: -1, minute: 0 },
    { hour: 0, minute: 60 },
    { hour: 0, minute: -1 },
    { hour: 1.5, minute: 0 },
    { hour: 0, minute: Number.NaN },
  ])('範囲外の時刻 %o を例外にする', (time) => {
    expect(() =>
      fromBusinessDateTime(parseBusinessDate('2026-10-26'), time),
    ).toThrow(RangeError);
  });

  test('型を偽った不正な業務日付を例外にする', () => {
    expect(() =>
      fromBusinessDateTime(
        '2026-02-30' as ReturnType<typeof parseBusinessDate>,
        {
          hour: 0,
          minute: 0,
        },
      ),
    ).toThrow(RangeError);
  });
});

describe('parseBusinessDate', () => {
  test.each([
    '2026-10-26',
    '2028-02-29',
    '2026-12-31',
    '0001-01-01',
    '9999-12-31',
  ])('正しい業務日付 %s をそのまま返す', (value) => {
    expect(parseBusinessDate(value)).toBe(
      value as ReturnType<typeof parseBusinessDate>,
    );
  });

  test.each([
    '',
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-1-01',
    '2026/01/01',
    '20260101',
    ' 2026-01-01',
    '2026-01-01T00:00',
    '0000-01-01',
    '１２３４-01-01',
  ])('不正な業務日付 %p を例外にする', (value) => {
    expect(() => parseBusinessDate(value)).toThrow(RangeError);
  });
});

describe('businessWeekOf', () => {
  test.each(['2025-12-29', '2025-12-31', '2026-01-01', '2026-01-04'])(
    '年をまたぐ週の %s は翌年の第1週になる',
    (value) => {
      expect(businessWeekOf(parseBusinessDate(value))).toEqual({
        isoYear: 2026,
        isoWeek: 1,
        start: parseBusinessDate('2025-12-29'),
        end: parseBusinessDate('2026-01-04'),
      });
    },
  );

  test('年をまたぐ週の後の月曜日は第2週になる', () => {
    expect(businessWeekOf(parseBusinessDate('2026-01-05'))).toEqual({
      isoYear: 2026,
      isoWeek: 2,
      start: parseBusinessDate('2026-01-05'),
      end: parseBusinessDate('2026-01-11'),
    });
  });

  test.each(['2026-12-28', '2027-01-01', '2027-01-03'])(
    '53週ある年の最終週に属する %s は前年の第53週になる',
    (value) => {
      expect(businessWeekOf(parseBusinessDate(value))).toEqual({
        isoYear: 2026,
        isoWeek: 53,
        start: parseBusinessDate('2026-12-28'),
        end: parseBusinessDate('2027-01-03'),
      });
    },
  );

  test('年の途中の日曜日は月曜日から始まる週の終了日になる', () => {
    expect(businessWeekOf(parseBusinessDate('2026-10-25'))).toEqual({
      isoYear: 2026,
      isoWeek: 43,
      start: parseBusinessDate('2026-10-19'),
      end: parseBusinessDate('2026-10-25'),
    });
  });

  test('型を偽った不正な業務日付を例外にする', () => {
    expect(() =>
      businessWeekOf('2026-13-01' as ReturnType<typeof parseBusinessDate>),
    ).toThrow(RangeError);
  });
});

describe('toUtcCronExpression', () => {
  test.each([
    { hour: 23, minute: 45, expected: '45 7 * * *' },
    { hour: 4, minute: 21, expected: '21 12 * * *' },
    { hour: 0, minute: 0, expected: '0 8 * * *' },
    { hour: 15, minute: 59, expected: '59 23 * * *' },
    { hour: 16, minute: 0, expected: '0 0 * * *' },
  ])(
    '業務時刻の$hour:$minuteはcron式「$expected」になる',
    ({ hour, minute, expected }) => {
      expect(toUtcCronExpression({ hour, minute })).toBe(expected);
    },
  );

  test.each([
    { hour: 24, minute: 0 },
    { hour: 0, minute: 60 },
    { hour: -1, minute: 30 },
    { hour: 7, minute: 0.5 },
  ])('範囲外の時刻 %o を例外にする', (time) => {
    expect(() => toUtcCronExpression(time)).toThrow(RangeError);
  });
});
