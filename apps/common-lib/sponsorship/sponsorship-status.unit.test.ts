import { describe, expect, test } from 'bun:test';

import {
  type ProductAvailability,
  SPONSORSHIP_STATUSES,
  SPONSORSHIP_STATUS_LABELS,
  type SponsorshipState,
  type SponsorshipStatus,
  deriveSponsorshipStatus,
  isTerminable,
  toExportStatus,
} from './sponsorship-status.ts';

const STARTS_ON = '2026-12-01';
const ENDS_ON = '2026-12-10';
const DAY_BEFORE_START = '2026-11-30';
const DAY_AFTER_END = '2026-12-11';
const MIDDLE = '2026-12-05';

describe('SPONSORSHIP_STATUSES', () => {
  test('見せる状態は6つ', () => {
    expect(SPONSORSHIP_STATUSES).toEqual([
      'pending_payment',
      'scheduled',
      'active',
      'paused',
      'ended',
      'terminated',
    ]);
    expect(Object.isFrozen(SPONSORSHIP_STATUSES)).toBe(true);
  });
});

describe('SPONSORSHIP_STATUS_LABELS', () => {
  test('状態ごとの表示名を持つ', () => {
    expect(SPONSORSHIP_STATUS_LABELS).toEqual({
      pending_payment: '未決済',
      scheduled: '掲載予定',
      active: '掲載中',
      paused: '表示停止中',
      ended: '終了',
      terminated: '強制終了',
    });
    expect(Object.isFrozen(SPONSORSHIP_STATUS_LABELS)).toBe(true);
  });
});

describe('deriveSponsorshipStatus', () => {
  const derive = (
    state: SponsorshipState,
    today: string,
    product: ProductAvailability,
  ): SponsorshipStatus =>
    deriveSponsorshipStatus({
      state,
      startsOn: STARTS_ON,
      endsOn: ENDS_ON,
      product,
      today,
    });

  test.each([DAY_BEFORE_START, STARTS_ON, ENDS_ON, DAY_AFTER_END] as const)(
    '未決済の申込は今日が%sでもpending_payment',
    (today) => {
      for (const product of ['visible', 'hidden', 'deleted'] as const) {
        expect(derive('pending_payment', today, product)).toBe(
          'pending_payment',
        );
      }
    },
  );

  test.each([DAY_BEFORE_START, STARTS_ON, ENDS_ON, DAY_AFTER_END] as const)(
    '強制終了した申込は今日が%sでもterminated',
    (today) => {
      for (const product of ['visible', 'hidden', 'deleted'] as const) {
        expect(derive('terminated', today, product)).toBe('terminated');
      }
    },
  );

  test.each([
    ['開始日の前日', DAY_BEFORE_START, 'visible', 'scheduled'],
    [
      '開始日の前日にプロダクトが表示できない',
      DAY_BEFORE_START,
      'hidden',
      'paused',
    ],
    [
      '開始日の前日にプロダクトが論理削除されている',
      DAY_BEFORE_START,
      'deleted',
      'ended',
    ],
    ['開始日の当日', STARTS_ON, 'visible', 'active'],
    ['開始日の当日にプロダクトが表示できない', STARTS_ON, 'hidden', 'paused'],
    [
      '開始日の当日にプロダクトが論理削除されている',
      STARTS_ON,
      'deleted',
      'ended',
    ],
    ['期間の途中', MIDDLE, 'visible', 'active'],
    ['期間の途中にプロダクトが表示できない', MIDDLE, 'hidden', 'paused'],
    ['終了日の当日', ENDS_ON, 'visible', 'active'],
    ['終了日の当日にプロダクトが表示できない', ENDS_ON, 'hidden', 'paused'],
    [
      '終了日の当日にプロダクトが論理削除されている',
      ENDS_ON,
      'deleted',
      'ended',
    ],
    ['終了日の翌日', DAY_AFTER_END, 'visible', 'ended'],
    [
      '終了日の翌日にプロダクトが表示できない',
      DAY_AFTER_END,
      'hidden',
      'ended',
    ],
    [
      '終了日の翌日にプロダクトが論理削除されている',
      DAY_AFTER_END,
      'deleted',
      'ended',
    ],
  ] as const)(
    '決済済みの申込は、%s(今日%s・プロダクト%s)なら%sになる',
    (_, today, product, expected) => {
      expect(derive('paid', today, product)).toBe(expected);
    },
  );
});

describe('toExportStatus', () => {
  test.each([
    'pending_payment',
    'scheduled',
    'active',
    'ended',
    'terminated',
  ] as const)('%sはそのままエクスポートの状態にする', (status) => {
    expect(toExportStatus(status, STARTS_ON, MIDDLE)).toBe(status);
  });

  test('開始日より前の表示停止中はscheduledにする', () => {
    expect(toExportStatus('paused', STARTS_ON, DAY_BEFORE_START)).toBe(
      'scheduled',
    );
  });

  test.each([STARTS_ON, MIDDLE])(
    '今日が%sの表示停止中はactiveにする',
    (today) => {
      expect(toExportStatus('paused', STARTS_ON, today)).toBe('active');
    },
  );
});

describe('isTerminable', () => {
  test.each([
    ['開始日の前日', DAY_BEFORE_START, 'visible'],
    ['開始日の前日の表示停止中', DAY_BEFORE_START, 'hidden'],
    ['期間の途中', MIDDLE, 'visible'],
    ['期間の途中の表示停止中', MIDDLE, 'hidden'],
    ['終了日の当日', ENDS_ON, 'visible'],
  ] as const)('決済済みで%sなら強制終了できる', (_, today, product) => {
    expect(
      isTerminable({ state: 'paid', endsOn: ENDS_ON, product, today }),
    ).toBe(true);
  });

  test('終了日の翌日には強制終了できない', () => {
    expect(
      isTerminable({
        state: 'paid',
        endsOn: ENDS_ON,
        product: 'visible',
        today: DAY_AFTER_END,
      }),
    ).toBe(false);
  });

  test('プロダクトが論理削除されていれば期間内でも強制終了できない', () => {
    expect(
      isTerminable({
        state: 'paid',
        endsOn: ENDS_ON,
        product: 'deleted',
        today: MIDDLE,
      }),
    ).toBe(false);
  });

  test.each(['pending_payment', 'terminated'] as const)(
    '%sの申込は強制終了できない',
    (state) => {
      expect(
        isTerminable({
          state,
          endsOn: ENDS_ON,
          product: 'visible',
          today: MIDDLE,
        }),
      ).toBe(false);
    },
  );
});
