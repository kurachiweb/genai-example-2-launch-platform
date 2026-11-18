import { describe, expect, test } from 'bun:test';

import { type BusinessDate, parseBusinessDate } from '../time/business-time.ts';
import { defaultFinalDate, yearScheduleFor } from './year-schedule.ts';
import {
  isPreviousYearSet,
  resolveTargetYear,
  TARGET_YEAR_LOOKUP_YEARS,
  type YearCalendarYear,
  type YearState,
} from './year-target-rules.ts';

interface YearOverride {
  readonly finalDate?: string;
  readonly source?: YearCalendarYear['source'];
  readonly state?: YearState;
}

function date(value: string): BusinessDate {
  return parseBusinessDate(value);
}

function calendarYear(
  year: number,
  override: YearOverride = {},
): YearCalendarYear {
  const finalDate =
    override.finalDate === undefined
      ? defaultFinalDate(year)
      : date(override.finalDate);
  return {
    year,
    schedule: yearScheduleFor(year, finalDate),
    source:
      override.source ??
      (override.finalDate === undefined ? 'default' : 'explicit'),
    state: override.state ?? 'planned',
  };
}

function calendarOf(
  overrides: Readonly<Record<number, YearOverride>> = {},
): (year: number) => YearCalendarYear {
  return (year) => calendarYear(year, overrides[year]);
}

describe('resolveTargetYear', () => {
  test('決済期限日の前日に確定したWeek優勝はその年の対象とする', () => {
    expect(defaultFinalDate(2027)).toBe(date('2027-05-30'));
    const resolution = resolveTargetYear(date('2027-05-23'), calendarOf());
    expect(resolution.kind).toBe('open');
    expect(resolution.kind === 'open' && resolution.year.year).toBe(2027);
  });

  test('決済期限日の当日に確定したWeek優勝は翌年の対象とする', () => {
    const resolution = resolveTargetYear(date('2027-05-24'), calendarOf());
    expect(resolution.kind).toBe('open');
    expect(resolution.kind === 'open' && resolution.year.year).toBe(2028);
  });

  test('前年の決済期限日の当日に確定したWeek優勝は凍結済みの前年でなく今年の対象とする', () => {
    const resolution = resolveTargetYear(
      date('2026-05-25'),
      calendarOf({ 2026: { state: 'frozen' } }),
    );
    expect(resolution.kind).toBe('open');
    expect(resolution.kind === 'open' && resolution.year.year).toBe(2027);
  });

  test('明示的に設定した決勝日の決済期限日で対象期間を区切る', () => {
    const calendar = calendarOf({ 2027: { finalDate: '2027-04-25' } });
    const before = resolveTargetYear(date('2027-04-18'), calendar);
    const onDeadline = resolveTargetYear(date('2027-04-19'), calendar);
    expect(before.kind === 'open' && before.year.year).toBe(2027);
    expect(onDeadline.kind === 'open' && onDeadline.year.year).toBe(2028);
  });

  test('開催しなかった前年の期間のWeek優勝は前年を飛ばして今年の対象とする(初年度)', () => {
    const calendar = calendarOf({ 2026: { state: 'not_held' } });
    const resolution = resolveTargetYear(date('2026-03-01'), calendar);
    expect(resolution.kind).toBe('open');
    expect(resolution.kind === 'open' && resolution.year).toEqual(
      calendarYear(2027),
    );
  });

  test('初年度は期間の起点を設けず、開催しなかった複数の年のWeek優勝を対象とする', () => {
    const calendar = calendarOf({
      2025: { state: 'not_held' },
      2026: { state: 'not_held' },
    });
    const resolution = resolveTargetYear(date('2025-01-05'), calendar);
    expect(resolution.kind === 'open' && resolution.year.year).toBe(2027);
  });

  test('行がある凍結前の年はその年の対象とする', () => {
    const resolution = resolveTargetYear(
      date('2027-02-14'),
      calendarOf({ 2027: { state: 'open' } }),
    );
    expect(resolution.kind).toBe('open');
    expect(resolution.kind === 'open' && resolution.year.state).toBe('open');
  });

  test('対象期間の年が凍結済みなら翌年へ移さず、その年への遅れとする', () => {
    const resolution = resolveTargetYear(
      date('2027-05-23'),
      calendarOf({ 2027: { state: 'frozen' } }),
    );
    expect(resolution).toEqual({ kind: 'late', year: 2027 });
  });

  test('1月初旬の決勝日で決済期限日が前年の12月になる年も決済期限日で判定する', () => {
    const calendar = calendarOf({ 2028: { finalDate: '2028-01-02' } });
    expect(calendar(2028).schedule.deadlineDate).toBe(date('2027-12-27'));

    const beforeDeadline = resolveTargetYear(date('2027-12-26'), calendar);
    const onDeadline = resolveTargetYear(date('2027-12-27'), calendar);
    const afterNewYear = resolveTargetYear(date('2028-01-01'), calendar);

    expect(beforeDeadline.kind === 'open' && beforeDeadline.year.year).toBe(
      2028,
    );
    expect(onDeadline.kind === 'open' && onDeadline.year.year).toBe(2029);
    expect(afterNewYear.kind === 'open' && afterNewYear.year.year).toBe(2029);
  });

  test('Week優勝の日の年から順に高々4年を調べ、前の年を調べない', () => {
    const looked: number[] = [];
    const calendar = calendarOf({ 2027: { state: 'not_held' } });
    resolveTargetYear(date('2027-06-01'), (year) => {
      looked.push(year);
      return calendar(year);
    });
    expect(looked).toEqual([2027, 2028]);
  });

  test('4年のどれも対象にならなければ例外にする', () => {
    const looked: number[] = [];
    const notHeld = (year: number): YearCalendarYear => {
      looked.push(year);
      return calendarYear(year, { state: 'not_held' });
    };
    expect(() => resolveTargetYear(date('2027-01-10'), notHeld)).toThrow(
      RangeError,
    );
    expect(looked).toEqual([2027, 2028, 2029, 2030]);
  });

  test('調べる年の数を、日程を先に読む側が使う定数として公開する', () => {
    const looked: number[] = [];
    expect(() =>
      resolveTargetYear(date('2027-01-10'), (year) => {
        looked.push(year);
        return calendarYear(year, { state: 'not_held' });
      }),
    ).toThrow(RangeError);
    expect(TARGET_YEAR_LOOKUP_YEARS).toBe(4);
    expect(looked).toHaveLength(TARGET_YEAR_LOOKUP_YEARS);
  });
});

describe('isPreviousYearSet', () => {
  test.each<YearState>(['planned', 'open', 'frozen'])(
    '前年が%sなら既定の日のままでも設定されていると扱う',
    (state) => {
      expect(isPreviousYearSet(calendarYear(2026, { state }))).toBe(true);
    },
  );

  test('前年を明示的に設定していても開催しなかったなら設定されていないと扱う', () => {
    expect(
      isPreviousYearSet(
        calendarYear(2026, { finalDate: '2026-05-24', state: 'not_held' }),
      ),
    ).toBe(false);
  });

  test('前年を開催しなかったなら設定されていないと扱う', () => {
    expect(isPreviousYearSet(calendarYear(2026, { state: 'not_held' }))).toBe(
      false,
    );
  });
});
