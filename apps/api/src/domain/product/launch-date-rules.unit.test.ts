import { describe, expect, test } from 'bun:test';

import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  addBusinessDays,
  checkLaunchDate,
  computeLaunchDateWindow,
  type LaunchBasis,
} from './launch-date-rules.ts';

const day = (value: string): BusinessDate => parseBusinessDate(value);

const at = (date: string, hour: number, minute: number): Date =>
  fromBusinessDateTime(day(date), { hour, minute });

const lost = (launchDate: string): LaunchBasis => ({
  launchDate: day(launchDate),
  outcome: 'lost',
});

const won = (launchDate: string): LaunchBasis => ({
  launchDate: day(launchDate),
  outcome: 'won',
});

describe('addBusinessDays', () => {
  test.each([
    ['同じ月の中', '2026-09-07', 7, '2026-09-14'],
    ['0日はそのままの日', '2026-09-07', 0, '2026-09-07'],
    ['月末をまたぐ', '2026-09-30', 1, '2026-10-01'],
    ['31日の月末をまたぐ', '2026-01-31', 1, '2026-02-01'],
    ['年末をまたぐ', '2026-12-31', 1, '2027-01-01'],
    ['今日から90日後', '2026-09-07', 90, '2026-12-06'],
    ['年末から90日後', '2026-12-31', 90, '2027-03-31'],
    ['うるう年の2月28日の翌日はうるう日', '2028-02-28', 1, '2028-02-29'],
    ['うるう日の翌日は3月1日', '2028-02-29', 1, '2028-03-01'],
    ['平年の2月28日の翌日は3月1日', '2027-02-28', 1, '2027-03-01'],
    ['負の日数で年末をまたいで戻る', '2027-01-05', -12, '2026-12-24'],
    ['負の日数でうるう日へ戻る', '2028-03-01', -1, '2028-02-29'],
  ])('%s: %s + %d日 = %s', (_, date, days, expected) => {
    expect(addBusinessDays(day(date), days)).toBe(day(expected));
  });
});

describe('computeLaunchDateWindow の基本の下限と上限', () => {
  test('23:39なら翌日から今日の90日後までを選べ、今日と91日後は選べない', () => {
    const window = computeLaunchDateWindow({
      now: at('2026-09-07', 23, 39),
      basis: null,
      entitled: false,
    });

    expect(window).toEqual({
      earliest: day('2026-09-08'),
      latest: day('2026-12-06'),
      unavailable: [
        {
          from: day('2026-09-07'),
          to: day('2026-09-07'),
          reason: 'pairing_deadline',
        },
        {
          from: day('2026-12-07'),
          to: day('2026-12-07'),
          reason: 'out_of_range',
        },
      ],
      relaunchIntervalDays: null,
    });
  });

  test('23:40なら翌々日からになり、翌日もペアリングの締め切りで選べない', () => {
    const window = computeLaunchDateWindow({
      now: at('2026-09-07', 23, 40),
      basis: null,
      entitled: false,
    });

    expect(window.earliest).toBe(day('2026-09-09'));
    expect(window.latest).toBe(day('2026-12-06'));
    expect(window.unavailable[0]).toEqual({
      from: day('2026-09-07'),
      to: day('2026-09-08'),
      reason: 'pairing_deadline',
    });
  });

  test('0:00は23:40より前として翌日からになる', () => {
    const window = computeLaunchDateWindow({
      now: at('2026-09-08', 0, 0),
      basis: null,
      entitled: false,
    });

    expect(window.earliest).toBe(day('2026-09-09'));
  });

  test('年末の23:40は年をまたいだ翌々日から、90日後の上限も年をまたぐ', () => {
    const window = computeLaunchDateWindow({
      now: at('2026-12-31', 23, 40),
      basis: null,
      entitled: false,
    });

    expect(window.earliest).toBe(day('2027-01-02'));
    expect(window.latest).toBe(day('2027-03-31'));
    expect(window.unavailable.at(-1)).toEqual({
      from: day('2027-04-01'),
      to: day('2027-04-01'),
      reason: 'out_of_range',
    });
  });
});

describe('computeLaunchDateWindow の敗北後の間隔', () => {
  test('2026-09-07の敗北で未加入なら09-14から選べ、間隔は7日', () => {
    const window = computeLaunchDateWindow({
      now: at('2026-09-08', 10, 0),
      basis: lost('2026-09-07'),
      entitled: false,
    });

    expect(window).toEqual({
      earliest: day('2026-09-14'),
      latest: day('2026-12-07'),
      unavailable: [
        {
          from: day('2026-09-08'),
          to: day('2026-09-08'),
          reason: 'pairing_deadline',
        },
        {
          from: day('2026-09-09'),
          to: day('2026-09-13'),
          reason: 'relaunch_interval',
        },
        {
          from: day('2026-12-08'),
          to: day('2026-12-08'),
          reason: 'out_of_range',
        },
      ],
      relaunchIntervalDays: 7,
    });
  });

  test('2026-09-07の敗北でUltrasなら09-09から選べ、間隔は2日', () => {
    const window = computeLaunchDateWindow({
      now: at('2026-09-07', 12, 0),
      basis: lost('2026-09-07'),
      entitled: true,
    });

    expect(window.earliest).toBe(day('2026-09-09'));
    expect(window.relaunchIntervalDays).toBe(2);
    expect(window.unavailable.slice(0, 2)).toEqual([
      {
        from: day('2026-09-07'),
        to: day('2026-09-07'),
        reason: 'pairing_deadline',
      },
      {
        from: day('2026-09-08'),
        to: day('2026-09-08'),
        reason: 'relaunch_interval',
      },
    ]);
  });

  test('Ultrasで敗北の翌日23:40より前なら、基本の下限と同じ09-09になり間隔は効いていない', () => {
    const window = computeLaunchDateWindow({
      now: at('2026-09-08', 23, 39),
      basis: lost('2026-09-07'),
      entitled: true,
    });

    expect(window.earliest).toBe(day('2026-09-09'));
    expect(window.relaunchIntervalDays).toBeNull();
    expect(
      window.unavailable.some(({ reason }) => reason === 'relaunch_interval'),
    ).toBe(false);
  });

  test('敗北から7日以上が過ぎていれば基本の下限だけになる', () => {
    const window = computeLaunchDateWindow({
      now: at('2026-09-20', 10, 0),
      basis: lost('2026-09-07'),
      entitled: false,
    });

    expect(window.earliest).toBe(day('2026-09-21'));
    expect(window.relaunchIntervalDays).toBeNull();
  });

  test('間隔が月末をまたぐ', () => {
    const window = computeLaunchDateWindow({
      now: at('2026-09-28', 10, 0),
      basis: lost('2026-09-28'),
      entitled: false,
    });

    expect(window.earliest).toBe(day('2026-10-05'));
  });

  test('勝利が基準なら間隔を掛けない(仮1)', () => {
    const window = computeLaunchDateWindow({
      now: at('2026-09-16', 23, 40),
      basis: won('2026-09-07'),
      entitled: false,
    });

    expect(window.earliest).toBe(day('2026-09-18'));
    expect(window.relaunchIntervalDays).toBeNull();
  });

  test('基準が無ければUltrasの特典の有無で変わらない', () => {
    const input = { now: at('2026-09-07', 10, 0), basis: null };

    expect(computeLaunchDateWindow({ ...input, entitled: true })).toEqual(
      computeLaunchDateWindow({ ...input, entitled: false }),
    );
  });
});

describe('checkLaunchDate', () => {
  const window = computeLaunchDateWindow({
    now: at('2026-09-08', 10, 0),
    basis: lost('2026-09-07'),
    entitled: false,
  });
  const bounds = { earliest: day('2026-09-14'), latest: day('2026-12-07') };

  test.each([
    ['最も早い日', '2026-09-14'],
    ['最も遅い日(今日から90日後)', '2026-12-07'],
  ])('%sは受け付ける', (_, date) => {
    expect(checkLaunchDate(window, day(date))).toEqual({ ok: true });
  });

  test.each([
    ['過去の日', '2026-09-01', 'pairing_deadline'],
    ['今日', '2026-09-08', 'pairing_deadline'],
    ['敗北後の間隔の最初の日', '2026-09-09', 'relaunch_interval'],
    ['敗北後の間隔の最後の日', '2026-09-13', 'relaunch_interval'],
    ['今日から91日後', '2026-12-08', 'out_of_range'],
    ['今日から1年後', '2027-09-08', 'out_of_range'],
  ] as const)('%sは理由と選べる最も早い日・遅い日を返す', (_, date, reason) => {
    expect(checkLaunchDate(window, day(date))).toEqual({
      ok: false,
      reason,
      ...bounds,
    });
  });

  test('23:40以降の翌日はペアリングの締め切りの理由になる', () => {
    const lateWindow = computeLaunchDateWindow({
      now: at('2026-09-07', 23, 40),
      basis: null,
      entitled: false,
    });

    expect(checkLaunchDate(lateWindow, day('2026-09-08'))).toEqual({
      ok: false,
      reason: 'pairing_deadline',
      earliest: day('2026-09-09'),
      latest: day('2026-12-06'),
    });
  });
});
