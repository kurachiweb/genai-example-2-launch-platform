import { describe, expect, test } from 'bun:test';

import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../time/business-time.ts';
import { dailyRoundPolicy } from '../tournament/round-schedule.ts';
import {
  entryWindowFor,
  isSundayLaunch,
  WEEK_ENTRY_PRICE_LOOKUP_KEY,
  weekFirstRoundDate,
} from './week-schedule.ts';

function date(value: string): BusinessDate {
  return parseBusinessDate(value);
}

function at(value: string, clock: string): Date {
  const [hour = 0, minute = 0] = clock.split(':').map(Number);
  return fromBusinessDateTime(date(value), { hour, minute });
}

describe('WEEK_ENTRY_PRICE_LOOKUP_KEY', () => {
  test('参加費の価格のlookup_keyはweek_tournament_entryである', () => {
    expect(WEEK_ENTRY_PRICE_LOOKUP_KEY).toBe('week_tournament_entry');
  });
});

describe('entryWindowFor', () => {
  test('受付期限・決済期限・組み合わせ決定は翌週月曜日の23:00・23:35・23:45である', () => {
    const window = entryWindowFor(date('2026-09-07'));

    expect(window).toEqual({
      weekStart: date('2026-09-07'),
      acceptUntil: at('2026-09-14', '23:00'),
      deadlineAt: at('2026-09-14', '23:35'),
      drawAt: at('2026-09-14', '23:45'),
    });
  });

  test('期限の時刻はUTCで翌週火曜日の7:00・7:35・7:45である', () => {
    const window = entryWindowFor(date('2026-09-07'));

    expect([
      window.acceptUntil.toISOString(),
      window.deadlineAt.toISOString(),
      window.drawAt.toISOString(),
    ]).toEqual([
      '2026-09-15T07:00:00.000Z',
      '2026-09-15T07:35:00.000Z',
      '2026-09-15T07:45:00.000Z',
    ]);
  });

  test('年をまたぐ週は翌年の月曜日が期限になる', () => {
    const window = entryWindowFor(date('2026-12-28'));

    expect(window.deadlineAt).toEqual(at('2027-01-04', '23:35'));
  });

  test('月曜日でない週の初日は例外になる', () => {
    expect(() => entryWindowFor(date('2026-09-08'))).toThrow(RangeError);
  });

  test('形式が誤った週の初日は例外になる', () => {
    expect(() => entryWindowFor('2026-9-7' as BusinessDate)).toThrow(
      RangeError,
    );
  });
});

describe('weekFirstRoundDate', () => {
  test('1回戦は翌週火曜日である', () => {
    expect(weekFirstRoundDate(date('2026-09-07'))).toBe(date('2026-09-15'));
  });

  test('年をまたぐ週の1回戦は翌年の火曜日である', () => {
    expect(weekFirstRoundDate(date('2026-12-28'))).toBe(date('2027-01-05'));
  });

  test('月曜日でない週の初日は例外になる', () => {
    expect(() => weekFirstRoundDate(date('2026-09-13'))).toThrow(RangeError);
  });

  test('組み合わせ決定の時刻に作ったラウンドの方針の1回戦の日と一致する', () => {
    const weekStart = date('2026-09-07');
    const policy = dailyRoundPolicy(
      weekFirstRoundDate(weekStart),
      entryWindowFor(weekStart).drawAt,
    );

    expect(policy.firstRoundDate).toBe(date('2026-09-15'));
  });

  test('組み合わせ決定が1回戦の日の0:10に遅れたら1回戦は翌日になる', () => {
    const policy = dailyRoundPolicy(
      weekFirstRoundDate(date('2026-09-07')),
      at('2026-09-15', '00:10'),
    );

    expect(policy.firstRoundDate).toBe(date('2026-09-16'));
  });
});

describe('isSundayLaunch', () => {
  test('日曜日のローンチは真である', () => {
    expect(isSundayLaunch(date('2026-09-13'))).toBe(true);
  });

  test('年をまたぐ週の日曜日のローンチは真である', () => {
    expect(isSundayLaunch(date('2027-01-03'))).toBe(true);
  });

  test.each(['2026-09-07', '2026-09-08', '2026-09-11', '2026-09-12'])(
    '日曜日でないローンチ(%s)は偽である',
    (value) => {
      expect(isSundayLaunch(date(value))).toBe(false);
    },
  );

  test('形式が誤ったローンチ日は例外になる', () => {
    expect(() => isSundayLaunch('2026/09/13' as BusinessDate)).toThrow(
      RangeError,
    );
  });
});
