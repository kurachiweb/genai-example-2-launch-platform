import { describe, expect, test } from 'bun:test';

import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  decideLaunchPlan,
  decideLocks,
  type IdentifiedLaunch,
  LAUNCH_PLAN_MESSAGES,
  type PlanBlock,
  type PlanLock,
} from './launch-plan.ts';

const day = (value: string): BusinessDate => parseBusinessDate(value);

const at = (date: string, hour: number, minute: number): Date =>
  fromBusinessDateTime(day(date), { hour, minute });

const NOW = at('2026-09-10', 10, 0);

const launch = (
  id: string,
  launchDate: string,
  overrides: Partial<Omit<IdentifiedLaunch, 'id' | 'launchDate'>> = {},
): IdentifiedLaunch => ({
  id,
  launchDate: day(launchDate),
  outcome: null,
  cancelledAt: null,
  ...overrides,
});

const finishedLost = launch('l-lost', '2026-09-07', { outcome: 'lost' });
const finishedWon = launch('l-won', '2026-09-07', { outcome: 'won' });
const scheduled = launch('l-scheduled', '2026-09-20');
const cancelled = launch('l-cancelled', '2026-09-25', {
  cancelledAt: at('2026-09-09', 12, 0),
});

const TOURNAMENT_BLOCK: PlanBlock = {
  code: 'tournament-week.result-pending',
  message:
    'このプロダクトはWeekトーナメントに参加できる期間中のため再ローンチできません。参加しない場合は9月14日(あと3日)に解除されます。',
  releaseAt: at('2026-09-14', 23, 35),
};

const plan = (
  launches: readonly IdentifiedLaunch[],
  overrides: Partial<{
    now: Date;
    hidden: boolean;
    sourceBlocks: readonly PlanBlock[] | 'unavailable';
  }> = {},
) =>
  decideLaunchPlan({
    now: NOW,
    hidden: false,
    launches,
    sourceBlocks: [],
    ...overrides,
  });

describe('LAUNCH_PLAN_MESSAGES', () => {
  test('文言規則の再ローンチ不可・固定の文言と一字一句一致し、変更できない', () => {
    expect(LAUNCH_PLAN_MESSAGES).toEqual({
      launch_scheduled:
        'このプロダクトはローンチ予定があるため再ローンチできません。',
      qualifier_in_progress:
        'このプロダクトは予選マッチに参加中のため再ローンチできません。',
      product_hidden:
        'このプロダクトは公開が停止されているため、ローンチを予約できません。',
      qualifier_match:
        'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。',
    });
    expect(Object.isFrozen(LAUNCH_PLAN_MESSAGES)).toBe(true);
  });
});

describe('decideLaunchPlan の次回の予約', () => {
  test('ローンチが無ければ基準なしで予約できる', () => {
    expect(plan([])).toEqual({ mode: 'new', basis: null });
  });

  test('直近のローンチが敗北で終了していれば、それを基準に予約できる', () => {
    expect(plan([finishedLost])).toEqual({
      mode: 'new',
      basis: { launchDate: day('2026-09-07'), outcome: 'lost' },
    });
  });

  test('直近のローンチが勝利で終了していれば、勝利を基準に予約できる', () => {
    expect(plan([finishedWon])).toEqual({
      mode: 'new',
      basis: { launchDate: day('2026-09-07'), outcome: 'won' },
    });
  });

  test('取消のローンチは直近から除き、その前の終了したローンチを基準にする', () => {
    expect(plan([cancelled, finishedLost])).toEqual({
      mode: 'new',
      basis: { launchDate: day('2026-09-07'), outcome: 'lost' },
    });
  });

  test('取消のローンチだけなら基準なしで予約できる', () => {
    expect(plan([cancelled])).toEqual({ mode: 'new', basis: null });
  });

  test('過去の取消のローンチの結果より前の終了したローンチを基準にする', () => {
    const olderWon = launch('l-older', '2026-08-01', { outcome: 'won' });
    const cancelledLost = launch('l-cancelled-lost', '2026-09-07', {
      outcome: 'lost',
      cancelledAt: at('2026-09-06', 10, 0),
    });

    expect(plan([cancelledLost, olderWon])).toEqual({
      mode: 'new',
      basis: { launchDate: day('2026-08-01'), outcome: 'won' },
    });
  });
});

describe('decideLaunchPlan のローンチ日の変更', () => {
  test('直近のローンチが予定なら変更になり、基準はその前の終了したローンチ', () => {
    expect(plan([scheduled, finishedLost])).toEqual({
      mode: 'reschedule',
      launchId: 'l-scheduled',
      current: day('2026-09-20'),
      basis: { launchDate: day('2026-09-07'), outcome: 'lost' },
    });
  });

  test('前のローンチが無ければ基準なしで変更になる', () => {
    expect(plan([scheduled])).toEqual({
      mode: 'reschedule',
      launchId: 'l-scheduled',
      current: day('2026-09-20'),
      basis: null,
    });
  });

  test('変更の基準からも取消のローンチを除く', () => {
    expect(plan([scheduled, cancelled, finishedWon])).toEqual({
      mode: 'reschedule',
      launchId: 'l-scheduled',
      current: day('2026-09-20'),
      basis: { launchDate: day('2026-09-07'), outcome: 'won' },
    });
  });

  test('変更は供給元の判定に依らない', () => {
    expect(plan([scheduled], { sourceBlocks: 'unavailable' }).mode).toBe(
      'reschedule',
    );
    expect(plan([scheduled], { sourceBlocks: [TOURNAMENT_BLOCK] }).mode).toBe(
      'reschedule',
    );
  });
});

describe('decideLaunchPlan の予約の禁止', () => {
  const tomorrowLaunch = launch('l-tomorrow', '2026-09-11');

  test('前日23:44は予定のため変更になる', () => {
    expect(plan([tomorrowLaunch], { now: at('2026-09-10', 23, 44) }).mode).toBe(
      'reschedule',
    );
  });

  test('前日23:45以降のペアリング済みはローンチ予定の文言で禁止する', () => {
    expect(plan([tomorrowLaunch], { now: at('2026-09-10', 23, 45) })).toEqual({
      mode: 'blocked',
      blocks: [
        {
          code: 'launch_scheduled',
          message:
            'このプロダクトはローンチ予定があるため再ローンチできません。',
          releaseAt: null,
        },
      ],
    });
  });

  test('ローンチ日の0:00以降で結果が未記録のマッチ中は予選マッチの文言で禁止する', () => {
    expect(plan([tomorrowLaunch], { now: at('2026-09-11', 0, 0) })).toEqual({
      mode: 'blocked',
      blocks: [
        {
          code: 'qualifier_in_progress',
          message:
            'このプロダクトは予選マッチに参加中のため再ローンチできません。',
          releaseAt: null,
        },
      ],
    });
  });

  test('結果が記録されれば禁止を解き、その結果を基準に予約できる', () => {
    const recorded = launch('l-tomorrow', '2026-09-11', { outcome: 'lost' });

    expect(plan([recorded], { now: at('2026-09-11', 1, 0) })).toEqual({
      mode: 'new',
      basis: { launchDate: day('2026-09-11'), outcome: 'lost' },
    });
  });

  test('非公開化中は非公開化の文言で禁止する', () => {
    expect(plan([finishedLost], { hidden: true })).toEqual({
      mode: 'blocked',
      blocks: [
        {
          code: 'product_hidden',
          message:
            'このプロダクトは公開が停止されているため、ローンチを予約できません。',
          releaseAt: null,
        },
      ],
    });
  });

  test('非公開化中は供給元の判定の失敗や該当より非公開化を示す', () => {
    expect(plan([], { hidden: true, sourceBlocks: 'unavailable' })).toEqual(
      plan([], { hidden: true }),
    );
    expect(
      plan([], { hidden: true, sourceBlocks: [TOURNAMENT_BLOCK] }),
    ).toEqual(plan([], { hidden: true }));
  });

  test('非公開化中でもマッチ中はマッチ中の文言で禁止する', () => {
    const today = launch('l-today', '2026-09-10');

    expect(plan([today], { hidden: true })).toEqual({
      mode: 'blocked',
      blocks: [
        {
          code: 'qualifier_in_progress',
          message: LAUNCH_PLAN_MESSAGES.qualifier_in_progress,
          releaseAt: null,
        },
      ],
    });
  });

  test('供給元の判定に失敗すれば確認できない状態にする', () => {
    expect(plan([finishedWon], { sourceBlocks: 'unavailable' })).toEqual({
      mode: 'unknown',
    });
  });

  test('供給元の条件に該当すれば、その理由と解除の日時で禁止する', () => {
    expect(plan([finishedWon], { sourceBlocks: [TOURNAMENT_BLOCK] })).toEqual({
      mode: 'blocked',
      blocks: [TOURNAMENT_BLOCK],
    });
  });

  test('供給元の条件が解除されれば即時に予約できる', () => {
    expect(plan([finishedWon], { sourceBlocks: [] })).toEqual({
      mode: 'new',
      basis: { launchDate: day('2026-09-07'), outcome: 'won' },
    });
  });
});

describe('decideLocks', () => {
  const SOURCE_LOCK: PlanLock = {
    code: 'tournament-week.in-match',
    message: 'Weekトーナメントのマッチ中のため変更できません。',
  };
  const tomorrowLaunch = launch('l-tomorrow', '2026-09-11');

  const locks = (
    launches: readonly IdentifiedLaunch[],
    now: Date,
    sourceLocks: readonly PlanLock[] | 'unavailable' = [],
  ) => decideLocks({ now, launches, sourceLocks });

  const QUALIFIER_LOCK: PlanLock = {
    code: 'qualifier_match',
    message:
      'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。',
  };

  test('ローンチが無ければ固定しない', () => {
    expect(locks([], NOW)).toEqual({
      locked: false,
      locks: [],
      unknown: false,
    });
  });

  test('前日23:44は固定しない', () => {
    expect(locks([tomorrowLaunch], at('2026-09-10', 23, 44)).locked).toBe(
      false,
    );
  });

  test('前日23:45から固定する', () => {
    expect(locks([tomorrowLaunch], at('2026-09-10', 23, 45))).toEqual({
      locked: true,
      locks: [QUALIFIER_LOCK],
      unknown: false,
    });
  });

  test('マッチ中も固定する', () => {
    expect(locks([tomorrowLaunch], at('2026-09-11', 12, 0)).locks).toEqual([
      QUALIFIER_LOCK,
    ]);
  });

  test('結果が記録されれば固定を解く', () => {
    const recorded = launch('l-tomorrow', '2026-09-11', { outcome: 'won' });

    expect(locks([recorded], at('2026-09-11', 12, 0)).locked).toBe(false);
  });

  test('取消のローンチは固定の判定から除く', () => {
    const cancelledTomorrow = launch('l-cancelled', '2026-09-11', {
      cancelledAt: at('2026-09-10', 12, 0),
    });

    expect(
      locks([cancelledTomorrow, finishedLost], at('2026-09-10', 23, 50)).locked,
    ).toBe(false);
  });

  test('供給元の固定を本機能の固定の後に合わせる', () => {
    expect(
      locks([tomorrowLaunch], at('2026-09-11', 12, 0), [SOURCE_LOCK]),
    ).toEqual({
      locked: true,
      locks: [QUALIFIER_LOCK, SOURCE_LOCK],
      unknown: false,
    });
  });

  test('供給元の固定だけでも固定する', () => {
    expect(locks([finishedLost], NOW, [SOURCE_LOCK])).toEqual({
      locked: true,
      locks: [SOURCE_LOCK],
      unknown: false,
    });
  });

  test('供給元の判定に失敗すれば、本機能の固定を残して確認できない状態にする', () => {
    expect(locks([finishedLost], NOW, 'unavailable')).toEqual({
      locked: false,
      locks: [],
      unknown: true,
    });
    expect(
      locks([tomorrowLaunch], at('2026-09-11', 12, 0), 'unavailable'),
    ).toEqual({
      locked: true,
      locks: [QUALIFIER_LOCK],
      unknown: true,
    });
  });
});
