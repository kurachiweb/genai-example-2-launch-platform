import { describe, expect, test } from 'bun:test';

import { parseBusinessDate } from '../time/business-time.ts';
import {
  deriveLaunchStatus,
  kickoffAt,
  LAUNCH_SELECTION_CUTOFF,
  type LaunchFacts,
  PAIRING_TIME,
  QUALIFIER_OUTCOMES,
  qualifierLockThresholdDate,
} from './launch-status.ts';

const LAUNCH_DATE = parseBusinessDate('2026-09-07');

// 業務時刻はUTC−8のため、業務日付09-07の0:00はUTCの09-07 8:00になる
const BEFORE_PAIRING = new Date('2026-09-07T07:44:59.999Z');
const AT_PAIRING = new Date('2026-09-07T07:45:00.000Z');
const BEFORE_KICKOFF = new Date('2026-09-07T07:59:59.999Z');
const AT_KICKOFF = new Date('2026-09-07T08:00:00.000Z');

function launch(overrides: Partial<LaunchFacts> = {}): LaunchFacts {
  return {
    launchDate: LAUNCH_DATE,
    outcome: null,
    cancelledAt: null,
    ...overrides,
  };
}

describe('業務時刻の境界の定数', () => {
  test('ペアリングは23:45、選べる日の切り替えは23:40で、変更できない', () => {
    expect(PAIRING_TIME).toEqual({ hour: 23, minute: 45 });
    expect(LAUNCH_SELECTION_CUTOFF).toEqual({ hour: 23, minute: 40 });
    expect(Object.isFrozen(PAIRING_TIME)).toBe(true);
    expect(Object.isFrozen(LAUNCH_SELECTION_CUTOFF)).toBe(true);
  });

  test('予選の結果は勝利と敗北の2つで、変更できない', () => {
    expect([...QUALIFIER_OUTCOMES]).toEqual(['won', 'lost']);
    expect(Object.isFrozen(QUALIFIER_OUTCOMES)).toBe(true);
  });
});

describe('kickoffAt', () => {
  test('ローンチ日の業務時刻の0:00を返す', () => {
    expect(kickoffAt(LAUNCH_DATE)).toEqual(AT_KICKOFF);
  });

  test('年をまたぐローンチ日でも業務時刻の0:00を返す', () => {
    expect(kickoffAt(parseBusinessDate('2027-01-01'))).toEqual(
      new Date('2027-01-01T08:00:00.000Z'),
    );
  });
});

describe('deriveLaunchStatus', () => {
  test.each([
    ['前日23:44台', new Date('2026-09-07T07:44:00.000Z'), 'scheduled'],
    ['前日23:45の直前', BEFORE_PAIRING, 'scheduled'],
    ['前日23:45', AT_PAIRING, 'paired'],
    ['ローンチ日の0:00の直前', BEFORE_KICKOFF, 'paired'],
    ['ローンチ日の0:00', AT_KICKOFF, 'in_progress'],
    ['ローンチ日の23:59', new Date('2026-09-08T07:59:00.000Z'), 'in_progress'],
    [
      '結果の記録待ちのローンチ日の翌日',
      new Date('2026-09-09T00:00:00.000Z'),
      'in_progress',
    ],
    ['2日前', new Date('2026-09-05T12:00:00.000Z'), 'scheduled'],
  ] as const)('未確定のローンチは%sに%sである', (_label, now, expected) => {
    expect(deriveLaunchStatus(launch(), now)).toBe(expected);
  });

  test.each(QUALIFIER_OUTCOMES)(
    '結果%sが記録されたローンチは、ローンチ日の前でもfinishedである',
    (outcome) => {
      expect(deriveLaunchStatus(launch({ outcome }), BEFORE_PAIRING)).toBe(
        'finished',
      );
      expect(deriveLaunchStatus(launch({ outcome }), AT_KICKOFF)).toBe(
        'finished',
      );
    },
  );

  test('取消は結果より優先し、時刻によらずcanceledである', () => {
    const cancelledAt = new Date('2026-09-01T00:00:00.000Z');

    expect(deriveLaunchStatus(launch({ cancelledAt }), BEFORE_PAIRING)).toBe(
      'canceled',
    );
    expect(deriveLaunchStatus(launch({ cancelledAt }), AT_KICKOFF)).toBe(
      'canceled',
    );
    expect(
      deriveLaunchStatus(launch({ cancelledAt, outcome: 'won' }), AT_KICKOFF),
    ).toBe('canceled');
  });

  test('月末の前日23:45から月初のローンチ日をpairedにする', () => {
    const facts = launch({ launchDate: parseBusinessDate('2026-10-01') });

    expect(
      deriveLaunchStatus(facts, new Date('2026-10-01T07:44:00.000Z')),
    ).toBe('scheduled');
    expect(
      deriveLaunchStatus(facts, new Date('2026-10-01T07:45:00.000Z')),
    ).toBe('paired');
  });
});

describe('qualifierLockThresholdDate', () => {
  test.each([
    ['23:44台は今日', new Date('2026-09-07T07:44:59.999Z'), '2026-09-06'],
    ['23:45は明日', new Date('2026-09-07T07:45:00.000Z'), '2026-09-07'],
    ['0:00は今日', new Date('2026-09-07T08:00:00.000Z'), '2026-09-07'],
    ['23:59は明日', new Date('2026-09-08T07:59:00.000Z'), '2026-09-08'],
    [
      '年末の23:45は翌年の元日',
      new Date('2027-01-01T07:45:00.000Z'),
      '2027-01-01',
    ],
    [
      'うるう日の前日の23:45はうるう日',
      new Date('2028-02-29T07:45:00.000Z'),
      '2028-02-29',
    ],
  ])('%sの業務日付を返す', (_label, now, expected) => {
    expect(qualifierLockThresholdDate(now)).toBe(parseBusinessDate(expected));
  });

  test('閾値の日以前のローンチ日の未確定のローンチは、導いた状態がpairedかin_progressになる', () => {
    const now = AT_PAIRING;
    const threshold = qualifierLockThresholdDate(now);

    expect(threshold).toBe(LAUNCH_DATE);
    expect(deriveLaunchStatus(launch({ launchDate: threshold }), now)).toBe(
      'paired',
    );
    expect(
      deriveLaunchStatus(
        launch({ launchDate: parseBusinessDate('2026-09-08') }),
        now,
      ),
    ).toBe('scheduled');
  });
});
