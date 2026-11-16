import { describe, expect, test } from 'bun:test';

import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../time/business-time.ts';
import { dailyRoundPolicy } from './round-schedule.ts';

function date(value: string): BusinessDate {
  return parseBusinessDate(value);
}

function at(value: string, clock: string): Date {
  const [hour = 0, minute = 0] = clock.split(':').map(Number);
  return fromBusinessDateTime(date(value), { hour, minute });
}

describe('dailyRoundPolicyの1回戦の日', () => {
  test('組み合わせ決定の23:45に作れば予定の日(翌日の火曜日)になる', () => {
    const policy = dailyRoundPolicy(
      date('2026-09-15'),
      at('2026-09-14', '23:45'),
    );

    expect(policy.firstRoundDate).toBe(date('2026-09-15'));
  });

  test('予定の日が現在の業務日付の翌日より後なら予定の日になる', () => {
    const policy = dailyRoundPolicy(
      date('2026-09-15'),
      at('2026-09-12', '10:00'),
    );

    expect(policy.firstRoundDate).toBe(date('2026-09-15'));
  });

  test('予定の日の0:10に作れば翌日へ遅れる', () => {
    const policy = dailyRoundPolicy(
      date('2026-09-15'),
      at('2026-09-15', '00:10'),
    );

    expect(policy.firstRoundDate).toBe(date('2026-09-16'));
  });

  test('予定の日を数日過ぎて作れば現在の業務日付の翌日になる', () => {
    const policy = dailyRoundPolicy(
      date('2026-09-15'),
      at('2026-09-17', '12:00'),
    );

    expect(policy.firstRoundDate).toBe(date('2026-09-18'));
  });
});

describe('dailyRoundPolicyの次ラウンドの日', () => {
  const policy = dailyRoundPolicy(
    date('2026-09-15'),
    at('2026-09-14', '23:45'),
  );

  test('前ラウンドの日の23:45に作れば翌日になる', () => {
    expect(
      policy.nextRoundDate(date('2026-09-15'), at('2026-09-15', '23:45')),
    ).toBe(date('2026-09-16'));
  });

  test('前ラウンドの日の結果の確定の直後(23:40)に作っても翌日になる', () => {
    expect(
      policy.nextRoundDate(date('2026-09-15'), at('2026-09-15', '23:40')),
    ).toBe(date('2026-09-16'));
  });

  test('翌日の0:10に作れば翌々日へ遅れる', () => {
    expect(
      policy.nextRoundDate(date('2026-09-15'), at('2026-09-16', '00:10')),
    ).toBe(date('2026-09-17'));
  });

  test('翌日の0:00ちょうどに作っても翌々日へ遅れる', () => {
    expect(
      policy.nextRoundDate(date('2026-09-15'), at('2026-09-16', '00:00')),
    ).toBe(date('2026-09-17'));
  });

  test('前ラウンドの日の23:59に作れば翌日になる', () => {
    expect(
      policy.nextRoundDate(date('2026-09-15'), at('2026-09-15', '23:59')),
    ).toBe(date('2026-09-16'));
  });

  test('遅れた後のラウンドは遅れた日から1日ずつ進む', () => {
    const quarterFinal = policy.nextRoundDate(
      date('2026-09-15'),
      at('2026-09-16', '00:10'),
    );
    const semiFinal = policy.nextRoundDate(
      quarterFinal,
      at(quarterFinal, '23:45'),
    );
    const final = policy.nextRoundDate(semiFinal, at(semiFinal, '23:45'));

    expect([quarterFinal, semiFinal, final]).toEqual([
      date('2026-09-17'),
      date('2026-09-18'),
      date('2026-09-19'),
    ]);
  });

  test('前ラウンドの日より前に作っても前ラウンドの日の翌日より早めない', () => {
    expect(
      policy.nextRoundDate(date('2026-09-17'), at('2026-09-15', '23:45')),
    ).toBe(date('2026-09-18'));
  });

  test('月と年をまたいでも翌日になる', () => {
    expect(
      policy.nextRoundDate(date('2026-12-31'), at('2026-12-31', '23:45')),
    ).toBe(date('2027-01-01'));
  });

  test('1回戦の日によらず同じ規則で次ラウンドの日を返す', () => {
    const other = dailyRoundPolicy(
      date('2027-03-02'),
      at('2027-03-01', '23:45'),
    );

    expect(
      other.nextRoundDate(date('2026-09-15'), at('2026-09-16', '00:10')),
    ).toBe(policy.nextRoundDate(date('2026-09-15'), at('2026-09-16', '00:10')));
  });
});
