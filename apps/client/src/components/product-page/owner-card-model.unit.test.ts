import { describe, expect, test } from 'bun:test';

import type { LaunchPlanView } from '../../graphql/my-products.ts';
import { relaunchReservationOf, withActionReport } from './owner-card-model.ts';

const planOf = (overrides: Partial<LaunchPlanView> = {}): LaunchPlanView => ({
  mode: 'new',
  currentLaunchDate: null,
  window: {
    earliest: '2026-11-18',
    latest: '2027-02-08',
    unavailable: [],
    relaunchIntervalDays: null,
  },
  blocks: [],
  locked: false,
  locks: [],
  lockUnknown: false,
  ultrasEntitled: false,
  ...overrides,
});

const INTERVAL_WINDOW = {
  earliest: '2026-11-18',
  latest: '2027-02-08',
  unavailable: [
    {
      from: '2026-11-11',
      to: '2026-11-17',
      reason: 'relaunch_interval' as const,
    },
  ],
  relaunchIntervalDays: 7,
};

const BLOCKS = [
  {
    code: 'tournament-week.entry-open',
    message:
      'このプロダクトはWeekトーナメントに参加できる期間中のため再ローンチできません。',
    releaseAt: '2026-11-14T15:00:00.000Z',
  },
  {
    code: 'product_hidden',
    message:
      'このプロダクトは公開が停止されているため、ローンチを予約できません。',
    releaseAt: null,
  },
];

describe('relaunchReservationOf', () => {
  test('照会の結果が届くまでは確かめている状態にする', () => {
    expect(relaunchReservationOf(undefined)).toStrictEqual({
      kind: 'checking',
    });
  });

  test('照会に失敗した・本人のプロダクトが見つからない・判定に失敗したなら確かめられない状態にする', () => {
    expect(relaunchReservationOf(null)).toStrictEqual({ kind: 'unconfirmed' });
    expect(
      relaunchReservationOf(planOf({ mode: 'unknown', window: null })),
    ).toStrictEqual({ kind: 'unconfirmed' });
  });

  test('予約が禁止されていれば、理由と解除の日時をすべて受け取った順で返す', () => {
    expect(
      relaunchReservationOf(
        planOf({ mode: 'blocked', window: null, blocks: BLOCKS }),
      ),
    ).toStrictEqual({ kind: 'blocked', blocks: BLOCKS });
  });

  test('間隔の制限が無ければ、選べる最も早い日を添えずに予約できる状態にする', () => {
    expect(relaunchReservationOf(planOf())).toStrictEqual({
      kind: 'available',
      earliestLaunchDate: null,
    });
    expect(
      relaunchReservationOf(
        planOf({ mode: 'reschedule', currentLaunchDate: '2026-11-20' }),
      ),
    ).toStrictEqual({ kind: 'available', earliestLaunchDate: null });
  });

  test('予選の敗北後の間隔の制限中は、予約できる状態に選べる最も早い日を添える', () => {
    expect(
      relaunchReservationOf(planOf({ window: INTERVAL_WINDOW })),
    ).toStrictEqual({ kind: 'available', earliestLaunchDate: '2026-11-18' });
    expect(
      relaunchReservationOf(
        planOf({
          mode: 'reschedule',
          currentLaunchDate: '2026-11-20',
          window: INTERVAL_WINDOW,
        }),
      ),
    ).toStrictEqual({ kind: 'available', earliestLaunchDate: '2026-11-18' });
  });

  test('選べる日が無い予約できる状態は、選べる最も早い日を添えない', () => {
    expect(relaunchReservationOf(planOf({ window: null }))).toStrictEqual({
      kind: 'available',
      earliestLaunchDate: null,
    });
  });
});

describe('withActionReport', () => {
  test('真の申告は操作を加え、偽の申告は操作を除く', () => {
    const reports = withActionReport(new Set(), 'test.first', true);

    expect([...reports]).toStrictEqual(['test.first']);
    expect([...withActionReport(reports, 'test.first', false)]).toStrictEqual(
      [],
    );
  });

  test('状態が変わらない申告は同じ集合を返し、元の集合を変えない', () => {
    const reports: ReadonlySet<string> = new Set(['test.first']);

    expect(withActionReport(reports, 'test.first', true)).toBe(reports);
    expect(withActionReport(reports, 'test.second', false)).toBe(reports);
    const added = withActionReport(reports, 'test.second', true);
    expect([...added]).toStrictEqual(['test.first', 'test.second']);
    expect([...reports]).toStrictEqual(['test.first']);
  });
});
