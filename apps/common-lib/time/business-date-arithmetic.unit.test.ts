import { describe, expect, test } from 'bun:test';

import {
  addBusinessDays,
  countBusinessDaysInclusive,
  formatCalendarDate,
  parseCalendarDate,
  utcMidnightOf,
} from './business-date-arithmetic.ts';

const INVALID_DATES = [
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
];

describe('parseCalendarDate', () => {
  test.each([
    ['2026-10-26', { year: 2026, month: 10, day: 26 }],
    ['2028-02-29', { year: 2028, month: 2, day: 29 }],
    ['0001-01-01', { year: 1, month: 1, day: 1 }],
    ['9999-12-31', { year: 9999, month: 12, day: 31 }],
  ] as const)('%s を年・月・日に分ける', (value, expected) => {
    expect(parseCalendarDate(value)).toEqual(expected);
  });

  test.each(INVALID_DATES)(
    '形式違反か実在しない日付 %p をRangeErrorにする',
    (value) => {
      expect(() => parseCalendarDate(value)).toThrow(RangeError);
    },
  );
});

describe('utcMidnightOf・formatCalendarDate', () => {
  test('暦日のUTCの0:00を返す', () => {
    expect(utcMidnightOf({ year: 2026, month: 3, day: 7 }).toISOString()).toBe(
      '2026-03-07T00:00:00.000Z',
    );
  });

  test('0〜99年を1900年代に読み替えない', () => {
    const utcMidnight = utcMidnightOf({ year: 1, month: 1, day: 1 });

    expect(utcMidnight.getUTCFullYear()).toBe(1);
    expect(formatCalendarDate(utcMidnight)).toBe('0001-01-01');
  });

  test('UTCの0:00の暦日をYYYY-MM-DDにする', () => {
    expect(formatCalendarDate(new Date('2027-01-05T00:00:00.000Z'))).toBe(
      '2027-01-05',
    );
  });
});

describe('addBusinessDays', () => {
  test.each([
    ['同じ月の中', '2026-09-07', 7, '2026-09-14'],
    ['0日はそのままの日', '2026-09-07', 0, '2026-09-07'],
    ['30日の月末をまたぐ', '2026-09-30', 1, '2026-10-01'],
    ['31日の月末をまたぐ', '2026-01-31', 1, '2026-02-01'],
    ['平年の2月末をまたぐ', '2026-02-28', 1, '2026-03-01'],
    ['年末をまたぐ', '2026-12-31', 1, '2027-01-01'],
    ['うるう年の2月28日の翌日はうるう日', '2028-02-28', 1, '2028-02-29'],
    ['うるう日の翌日は3月1日', '2028-02-29', 1, '2028-03-01'],
    ['うるう年をまたいで365日後', '2028-01-01', 365, '2028-12-31'],
    ['負の日数で年末をまたいで戻る', '2027-01-05', -12, '2026-12-24'],
    ['負の日数でうるう日へ戻る', '2028-03-01', -1, '2028-02-29'],
    ['負の日数で月末へ戻る', '2026-05-01', -1, '2026-04-30'],
  ])('%s: %s + %d日 = %s', (_, date, days, expected) => {
    expect(addBusinessDays(date, days)).toBe(expected);
  });

  test.each(INVALID_DATES)(
    '形式違反か実在しない日付 %p をRangeErrorにする',
    (value) => {
      expect(() => addBusinessDays(value, 1)).toThrow(RangeError);
    },
  );
});

describe('countBusinessDaysInclusive', () => {
  test.each([
    ['同じ日は1日', '2026-09-07', '2026-09-07', 1],
    ['翌日までは2日', '2026-09-07', '2026-09-08', 2],
    ['月末をまたぐ', '2026-09-29', '2026-10-02', 4],
    ['平年の2月をまたぐ', '2026-02-01', '2026-03-01', 29],
    ['うるう年の2月をまたぐ', '2028-02-01', '2028-03-01', 30],
    ['年末をまたぐ', '2026-12-30', '2027-01-02', 4],
    ['平年の1年', '2026-01-01', '2026-12-31', 365],
    ['うるう年の1年', '2028-01-01', '2028-12-31', 366],
    ['終わりが始まりの前日なら0', '2026-09-08', '2026-09-07', 0],
    ['終わりが始まりより前の年なら0', '2027-01-01', '2026-01-01', 0],
  ])('%s: %s〜%s は %d日', (_, from, to, expected) => {
    expect(countBusinessDaysInclusive(from, to)).toBe(expected);
  });

  test.each([-400, -1, 0, 1, 365, 400])(
    'addBusinessDaysで%d日足した日までの日数と一致する',
    (days) => {
      const from = '2027-11-30';

      expect(
        countBusinessDaysInclusive(from, addBusinessDays(from, days)),
      ).toBe(Math.max(days + 1, 0));
    },
  );

  test.each(INVALID_DATES)(
    '形式違反か実在しない日付 %p をRangeErrorにする',
    (value) => {
      expect(() => countBusinessDaysInclusive(value, '2026-01-01')).toThrow(
        RangeError,
      );
      expect(() => countBusinessDaysInclusive('2026-01-01', value)).toThrow(
        RangeError,
      );
    },
  );
});
