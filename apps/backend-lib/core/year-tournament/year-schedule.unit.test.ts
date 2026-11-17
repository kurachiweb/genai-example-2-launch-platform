import { describe, expect, test } from 'bun:test';

import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../time/business-time.ts';
import {
  defaultFinalDate,
  FINAL_DATE_MAX_GAP_DAYS,
  FINAL_DATE_MIN_LEAD_DAYS,
  YEAR_ENTRY_PRICE_LOOKUP_KEY,
  YEAR_MAX_PARTICIPANTS,
  yearFirstRoundDate,
  yearScheduleFor,
} from './year-schedule.ts';

function date(value: string): BusinessDate {
  return parseBusinessDate(value);
}

function at(value: string, clock: string): Date {
  const [hour = 0, minute = 0] = clock.split(':').map(Number);
  return fromBusinessDateTime(date(value), { hour, minute });
}

describe('Yearトーナメントの定数', () => {
  test('参加費の価格のlookup_keyはyear_tournament_entryである', () => {
    expect(YEAR_ENTRY_PRICE_LOOKUP_KEY).toBe('year_tournament_entry');
  });

  test('参加数の上限は64である', () => {
    expect(YEAR_MAX_PARTICIPANTS).toBe(64);
  });

  test('決勝日は8日後以降で、前後の年の決勝日との間は448日(64週)未満である', () => {
    expect([FINAL_DATE_MIN_LEAD_DAYS, FINAL_DATE_MAX_GAP_DAYS]).toEqual([
      8, 448,
    ]);
  });
});

describe('defaultFinalDate', () => {
  test.each([
    [2020, '2020-05-31'],
    [2026, '2026-05-31'],
  ])('5月31日が日曜日の年(%d)は5月31日である', (year, expected) => {
    expect(defaultFinalDate(year)).toBe(date(expected));
  });

  test.each([
    [2021, '2021-05-30'],
    [2027, '2027-05-30'],
    [2032, '2032-05-30'],
  ])('5月31日が月曜日の年(%d)は5月30日である', (year, expected) => {
    expect(defaultFinalDate(year)).toBe(date(expected));
  });

  test.each([
    [2024, '2024-05-26'],
    [2025, '2025-05-25'],
    [2028, '2028-05-28'],
  ])('その他の曜日の年(%d)も5月の最終日曜日である', (year, expected) => {
    expect(defaultFinalDate(year)).toBe(date(expected));
  });

  test.each([0, 10_000, 2026.5, Number.NaN])(
    '業務日付にできない年(%p)は例外になる',
    (year) => {
      expect(() => defaultFinalDate(year)).toThrow(RangeError);
    },
  );
});

describe('yearScheduleFor', () => {
  test('決済期限日は決勝日の6日前で、受付期限・決済期限・組み合わせ決定は同日の23:00・23:35・23:45、変更期限は7日前の0:00である', () => {
    const schedule = yearScheduleFor(2026, date('2026-05-24'));

    expect(schedule).toEqual({
      year: 2026,
      finalDate: date('2026-05-24'),
      deadlineDate: date('2026-05-18'),
      acceptUntil: at('2026-05-18', '23:00'),
      deadlineAt: at('2026-05-18', '23:35'),
      drawAt: at('2026-05-18', '23:45'),
      changeLockAt: at('2026-05-17', '00:00'),
    });
  });

  test('期限の時刻はUTCで決済期限日の翌日の7:00・7:35・7:45、変更期限は決勝日の7日前の8:00である', () => {
    const schedule = yearScheduleFor(2027, date('2027-05-30'));

    expect([
      schedule.acceptUntil.toISOString(),
      schedule.deadlineAt.toISOString(),
      schedule.drawAt.toISOString(),
      schedule.changeLockAt.toISOString(),
    ]).toEqual([
      '2027-05-25T07:00:00.000Z',
      '2027-05-25T07:35:00.000Z',
      '2027-05-25T07:45:00.000Z',
      '2027-05-23T08:00:00.000Z',
    ]);
  });

  test('既定の決勝日からも同じ規則で求める', () => {
    const schedule = yearScheduleFor(2027, defaultFinalDate(2027));

    expect(schedule.deadlineDate).toBe(date('2027-05-24'));
  });

  test('1月初旬の決勝日の決済期限日と変更期限は前年の12月である', () => {
    const schedule = yearScheduleFor(2028, date('2028-01-02'));

    expect({
      deadlineDate: schedule.deadlineDate,
      deadlineAt: schedule.deadlineAt,
      changeLockAt: schedule.changeLockAt,
    }).toEqual({
      deadlineDate: date('2027-12-27'),
      deadlineAt: at('2027-12-27', '23:35'),
      changeLockAt: at('2027-12-26', '00:00'),
    });
  });

  test('日曜日でない決勝日は例外になる', () => {
    expect(() => yearScheduleFor(2027, date('2027-05-31'))).toThrow(RangeError);
  });

  test('対象年に含まれない決勝日は例外になる', () => {
    expect(() => yearScheduleFor(2027, date('2028-01-02'))).toThrow(RangeError);
  });

  test('形式が誤った決勝日は例外になる', () => {
    expect(() => yearScheduleFor(2027, '2027/05/30' as BusinessDate)).toThrow(
      RangeError,
    );
  });
});

describe('yearFirstRoundDate', () => {
  const finalDate = date('2027-05-30');

  test.each([
    [2, '2027-05-30'],
    [3, '2027-05-29'],
    [4, '2027-05-29'],
    [5, '2027-05-28'],
    [8, '2027-05-28'],
    [9, '2027-05-27'],
    [13, '2027-05-27'],
    [16, '2027-05-27'],
    [17, '2027-05-26'],
    [32, '2027-05-26'],
    [33, '2027-05-25'],
    [64, '2027-05-25'],
  ])('参加数%dの1回戦は%sである', (participantCount, expected) => {
    expect(yearFirstRoundDate(finalDate, participantCount)).toBe(
      date(expected),
    );
  });

  test('Yearトーナメント規則の例(N = 13、決勝日2026-05-24)の1回戦は3日前の2026-05-21である', () => {
    expect(yearFirstRoundDate(date('2026-05-24'), 13)).toBe(date('2026-05-21'));
  });

  test('参加数64の1回戦は決済期限日の翌日である', () => {
    expect(yearFirstRoundDate(finalDate, 64)).toBe(date('2027-05-25'));
  });

  test('1月初旬の決勝日の1回戦は前年の12月になり得る', () => {
    expect(yearFirstRoundDate(date('2028-01-02'), 33)).toBe(date('2027-12-28'));
  });

  test.each([0, 1])('参加数%dは1回戦が無い', (participantCount) => {
    expect(yearFirstRoundDate(finalDate, participantCount)).toBeNull();
  });

  test('参加数65は例外になる', () => {
    expect(() => yearFirstRoundDate(finalDate, 65)).toThrow(RangeError);
  });

  test.each([-1, 2.5])('不正な参加数(%p)は例外になる', (participantCount) => {
    expect(() => yearFirstRoundDate(finalDate, participantCount)).toThrow(
      RangeError,
    );
  });

  test('日曜日でない決勝日は例外になる', () => {
    expect(() => yearFirstRoundDate(date('2027-05-31'), 2)).toThrow(RangeError);
  });

  test('日曜日でない決勝日は参加数1以下でも例外になる', () => {
    expect(() => yearFirstRoundDate(date('2027-05-31'), 1)).toThrow(RangeError);
  });
});
