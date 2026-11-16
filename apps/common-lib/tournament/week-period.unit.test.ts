import { describe, expect, test } from 'bun:test';

import {
  formatWeekPeriodLabel,
  isoWeekKey,
  type IsoWeekKey,
  parseIsoWeek,
  weekStartOf,
} from './week-period.ts';

describe('weekStartOf', () => {
  test.each([
    ['2026-09-07', '2026-09-07'],
    ['2026-09-10', '2026-09-07'],
    ['2026-09-13', '2026-09-07'],
  ])('%sを含む週の月曜日は%sである', (date, expected) => {
    expect(weekStartOf(date)).toBe(expected);
  });

  test.each([
    ['2026-10-01', '2026-09-28'],
    ['2027-01-03', '2026-12-28'],
    ['2024-03-02', '2024-02-26'],
  ])('月や年をまたぐ週の%sは前の月の月曜日%sにする', (date, expected) => {
    expect(weekStartOf(date)).toBe(expected);
  });

  test('受け付ける最初の年の0001-01-07は同じ月の月曜日0001-01-01にする', () => {
    expect(weekStartOf('0001-01-07')).toBe('0001-01-01');
  });

  test.each([
    '2026-9-7',
    '2026-09-07T00:00:00Z',
    '',
    '2026-02-29',
    '0000-01-03',
  ])('YYYY-MM-DDの形でない・存在しない日付%pはRangeErrorにする', (date) => {
    expect(() => weekStartOf(date)).toThrow(RangeError);
  });
});

describe('isoWeekKey', () => {
  test('週の月曜日からISO週のキーを作る', () => {
    expect(isoWeekKey('2026-09-07')).toBe('2026-W37');
  });

  test('週の途中の日付はその日を含む週のキーにする', () => {
    expect(isoWeekKey('2026-09-13')).toBe('2026-W37');
  });

  test.each([
    ['2025-12-29', '2026-W01'],
    ['2026-01-04', '2026-W01'],
    ['2026-12-28', '2026-W53'],
    ['2027-01-03', '2026-W53'],
    ['2027-01-04', '2027-W01'],
    ['2020-12-28', '2020-W53'],
    ['2021-01-04', '2021-W01'],
    ['2018-12-31', '2019-W01'],
  ] as const)(
    '年の境界の%sはその週の木曜日の年でキーを%sにする',
    (date, expected) => {
      expect(isoWeekKey(date)).toBe(expected);
    },
  );

  test('年と週の番号を4桁と2桁に0で埋める', () => {
    expect(isoWeekKey('0001-01-01')).toBe('0001-W01');
  });

  test('存在しない日付はRangeErrorにする', () => {
    expect(() => isoWeekKey('2026-13-01')).toThrow(RangeError);
  });
});

describe('parseIsoWeek', () => {
  test('ISO週のキーをその週の月曜日にする', () => {
    expect(parseIsoWeek('2026-W37')).toEqual({ weekStart: '2026-09-07' });
  });

  test.each([
    ['2026-W01', '2025-12-29'],
    ['2026-W53', '2026-12-28'],
    ['2027-W01', '2027-01-04'],
    ['2020-W53', '2020-12-28'],
    ['2021-W01', '2021-01-04'],
    ['2019-W01', '2018-12-31'],
    ['0001-W01', '0001-01-01'],
    ['9999-W52', '9999-12-27'],
  ])('年の境界のキー%sは週の月曜日%sにする', (key, expected) => {
    expect(parseIsoWeek(key)).toEqual({ weekStart: expected });
  });

  test.each(['2026-W37', '2026-W01', '2026-W53', '2020-W53', '2021-W01'])(
    '週の月曜日のキーを作り直すと元のキー%sに戻る',
    (key) => {
      const parsed = parseIsoWeek(key);

      expect(parsed).toBeDefined();
      expect(isoWeekKey(parsed?.weekStart ?? '')).toBe(key as IsoWeekKey);
    },
  );

  test.each([
    '2026',
    '2026-W7',
    '2026-w37',
    '2026W37',
    '2026-W037',
    ' 2026-W37',
    '20260-W01',
    '',
  ])('形式違反のキー%pはundefinedにする', (key) => {
    expect(parseIsoWeek(key)).toBeUndefined();
  });

  test('年の範囲外のキーはundefinedにする', () => {
    expect(parseIsoWeek('0000-W01')).toBeUndefined();
  });

  test.each(['2026-W00', '2026-W54', '2027-W53', '2025-W53', '2021-W53'])(
    'その年に無い週番号のキー%sはundefinedにする',
    (key) => {
      expect(parseIsoWeek(key)).toBeUndefined();
    },
  );
});

describe('formatWeekPeriodLabel', () => {
  test('週の表記はISO週の年と番号と月曜日〜日曜日の月日で示す', () => {
    expect(formatWeekPeriodLabel('2026-09-07')).toBe('2026年第37週(9/7〜9/13)');
  });

  test.each([
    ['2025-12-29', '2026年第1週(12/29〜1/4)'],
    ['2026-12-28', '2026年第53週(12/28〜1/3)'],
    ['2027-01-04', '2027年第1週(1/4〜1/10)'],
    ['2020-12-28', '2020年第53週(12/28〜1/3)'],
    ['2021-01-04', '2021年第1週(1/4〜1/10)'],
    ['9999-12-27', '9999年第52週(12/27〜1/2)'],
  ])('年末年始の週%sは%sと示す', (weekStart, expected) => {
    expect(formatWeekPeriodLabel(weekStart)).toBe(expected);
  });

  test('週の途中の日付はその日を含む週を示す', () => {
    expect(formatWeekPeriodLabel('2026-09-10')).toBe('2026年第37週(9/7〜9/13)');
  });

  test('存在しない日付はRangeErrorにする', () => {
    expect(() => formatWeekPeriodLabel('2026-02-30')).toThrow(RangeError);
  });
});
