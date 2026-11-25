import { describe, expect, test } from 'bun:test';

import {
  SPONSORSHIP_MAX_DAYS,
  SPONSORSHIP_MAX_LEAD_DAYS,
  computePeriodWindows,
  periodsOverlap,
  validatePeriod,
} from './sponsorship-period.ts';

const TODAY = '2026-11-18';
const TODAY_PLUS_365 = '2027-11-18';
const TODAY_PLUS_366 = '2027-11-19';

describe('上限の値', () => {
  test('掲載期間は366日まで、開始日は今日から365日後まで', () => {
    expect(SPONSORSHIP_MAX_DAYS).toBe(366);
    expect(SPONSORSHIP_MAX_LEAD_DAYS).toBe(365);
  });
});

describe('validatePeriod', () => {
  test('今日に始まり今日に終わる1日の期間に違反は無い', () => {
    expect(
      validatePeriod({ startsOn: TODAY, endsOn: TODAY, today: TODAY }),
    ).toEqual({});
  });

  test('今日より前の開始日はpast', () => {
    expect(
      validatePeriod({
        startsOn: '2026-11-17',
        endsOn: '2026-11-20',
        today: TODAY,
      }),
    ).toEqual({ startsOn: 'past' });
  });

  test('今日から365日後の開始日は受け付ける', () => {
    expect(
      validatePeriod({
        startsOn: TODAY_PLUS_365,
        endsOn: TODAY_PLUS_365,
        today: TODAY,
      }),
    ).toEqual({});
  });

  test('今日から366日後の開始日はtoo-far', () => {
    expect(
      validatePeriod({
        startsOn: TODAY_PLUS_366,
        endsOn: TODAY_PLUS_366,
        today: TODAY,
      }),
    ).toEqual({ startsOn: 'too-far' });
  });

  test('366日の期間は受け付ける', () => {
    expect(
      validatePeriod({ startsOn: TODAY, endsOn: TODAY_PLUS_365, today: TODAY }),
    ).toEqual({});
  });

  test('367日の期間はtoo-long', () => {
    expect(
      validatePeriod({ startsOn: TODAY, endsOn: TODAY_PLUS_366, today: TODAY }),
    ).toEqual({ endsOn: 'too-long' });
  });

  test('閏日を含む366日の期間は受け付け、367日はtoo-long', () => {
    expect(
      validatePeriod({
        startsOn: '2028-01-01',
        endsOn: '2028-12-31',
        today: '2027-12-01',
      }),
    ).toEqual({});
    expect(
      validatePeriod({
        startsOn: '2028-01-01',
        endsOn: '2029-01-01',
        today: '2027-12-01',
      }),
    ).toEqual({ endsOn: 'too-long' });
  });

  test('終了日が開始日より前ならbefore-start', () => {
    expect(
      validatePeriod({
        startsOn: '2026-11-20',
        endsOn: '2026-11-19',
        today: TODAY,
      }),
    ).toEqual({ endsOn: 'before-start' });
  });

  test('開始日の違反と終了日の違反を同時に返す', () => {
    expect(
      validatePeriod({
        startsOn: '2026-11-10',
        endsOn: '2026-11-09',
        today: TODAY,
      }),
    ).toEqual({ startsOn: 'past', endsOn: 'before-start' });
  });

  test.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-11-1', ''])(
    '実在しない日付や形の違う開始日%sはinvalidで、終了日との前後を判定しない',
    (startsOn) => {
      expect(
        validatePeriod({ startsOn, endsOn: '2026-11-20', today: TODAY }),
      ).toEqual({ startsOn: 'invalid' });
    },
  );

  test.each(['2027-02-29', '2026-11-31', '2026/11/20'])(
    '実在しない日付や形の違う終了日%sはinvalid',
    (endsOn) => {
      expect(validatePeriod({ startsOn: TODAY, endsOn, today: TODAY })).toEqual(
        { endsOn: 'invalid' },
      );
    },
  );

  test('開始日と終了日の両方が実在しなければ両方invalid', () => {
    expect(
      validatePeriod({
        startsOn: '2026-02-30',
        endsOn: '2026-02-31',
        today: TODAY,
      }),
    ).toEqual({ startsOn: 'invalid', endsOn: 'invalid' });
  });
});

describe('periodsOverlap', () => {
  test('一方の終了日と他方の開始日が同じ日なら重なる', () => {
    expect(
      periodsOverlap(
        { startsOn: '2026-12-01', endsOn: '2026-12-10' },
        { startsOn: '2026-12-10', endsOn: '2026-12-20' },
      ),
    ).toBe(true);
    expect(
      periodsOverlap(
        { startsOn: '2026-12-10', endsOn: '2026-12-20' },
        { startsOn: '2026-12-01', endsOn: '2026-12-10' },
      ),
    ).toBe(true);
  });

  test('隣り合う期間は重ならない', () => {
    expect(
      periodsOverlap(
        { startsOn: '2026-12-01', endsOn: '2026-12-09' },
        { startsOn: '2026-12-10', endsOn: '2026-12-20' },
      ),
    ).toBe(false);
    expect(
      periodsOverlap(
        { startsOn: '2026-12-10', endsOn: '2026-12-20' },
        { startsOn: '2026-12-01', endsOn: '2026-12-09' },
      ),
    ).toBe(false);
  });

  test('一方が他方を含めば重なる', () => {
    expect(
      periodsOverlap(
        { startsOn: '2026-12-01', endsOn: '2026-12-31' },
        { startsOn: '2026-12-10', endsOn: '2026-12-10' },
      ),
    ).toBe(true);
  });
});

describe('computePeriodWindows', () => {
  describe('開始日の範囲', () => {
    test('決済済みの期間が無ければ今日から365日後までを選べる', () => {
      expect(
        computePeriodWindows({ today: TODAY, startsOn: null, paidPeriods: [] }),
      ).toEqual({
        start: { earliest: TODAY, latest: TODAY_PLUS_365, unavailable: [] },
        end: null,
      });
    });

    test('決済済みの期間の各日を重なりとして選べない', () => {
      const { start } = computePeriodWindows({
        today: TODAY,
        startsOn: null,
        paidPeriods: [
          { startsOn: '2026-12-01', endsOn: '2026-12-10' },
          { startsOn: '2027-01-05', endsOn: '2027-01-05' },
        ],
      });
      expect(start.unavailable).toEqual([
        { from: '2026-12-01', to: '2026-12-10', reason: 'overlap' },
        { from: '2027-01-05', to: '2027-01-05', reason: 'overlap' },
      ]);
    });

    test('今日より前に終わる期間は無視する', () => {
      const { start } = computePeriodWindows({
        today: TODAY,
        startsOn: null,
        paidPeriods: [{ startsOn: '2026-11-01', endsOn: '2026-11-17' }],
      });
      expect(start.unavailable).toEqual([]);
    });

    test('今日をまたぐ期間は今日からの範囲に切り詰める', () => {
      const { start } = computePeriodWindows({
        today: TODAY,
        startsOn: null,
        paidPeriods: [{ startsOn: '2026-11-01', endsOn: '2026-11-25' }],
      });
      expect(start.unavailable).toEqual([
        { from: TODAY, to: '2026-11-25', reason: 'overlap' },
      ]);
    });

    test('今日に終わる期間は今日の1日を選べない', () => {
      const { start } = computePeriodWindows({
        today: TODAY,
        startsOn: null,
        paidPeriods: [{ startsOn: '2026-11-10', endsOn: TODAY }],
      });
      expect(start.unavailable).toEqual([
        { from: TODAY, to: TODAY, reason: 'overlap' },
      ]);
    });

    test('今日から365日後をまたぐ期間は365日後までに切り詰める', () => {
      const { start } = computePeriodWindows({
        today: TODAY,
        startsOn: null,
        paidPeriods: [{ startsOn: '2027-11-10', endsOn: '2027-12-31' }],
      });
      expect(start.unavailable).toEqual([
        { from: '2027-11-10', to: TODAY_PLUS_365, reason: 'overlap' },
      ]);
    });

    test('今日から365日後より後に始まる期間で範囲を作らない', () => {
      const { start } = computePeriodWindows({
        today: TODAY,
        startsOn: null,
        paidPeriods: [{ startsOn: TODAY_PLUS_366, endsOn: '2027-12-31' }],
      });
      expect(start.unavailable).toEqual([]);
    });

    test('昇順でない決済済みの期間も開始日の昇順で返す', () => {
      const { start } = computePeriodWindows({
        today: TODAY,
        startsOn: null,
        paidPeriods: [
          { startsOn: '2027-01-05', endsOn: '2027-01-06' },
          { startsOn: '2026-12-01', endsOn: '2026-12-10' },
        ],
      });
      expect(start.unavailable.map(({ from }) => from)).toEqual([
        '2026-12-01',
        '2027-01-05',
      ]);
    });
  });

  describe('終了日の範囲', () => {
    test('後に続く決済済みの期間が無ければ開始日から開始日+365日までを選べる', () => {
      expect(
        computePeriodWindows({
          today: TODAY,
          startsOn: '2026-12-01',
          paidPeriods: [],
        }).end,
      ).toEqual({
        earliest: '2026-12-01',
        latest: '2027-12-01',
        unavailable: [],
      });
    });

    test('後に続く決済済みの期間の開始日の前日で打ち切り、その後を重なりとして選べない', () => {
      expect(
        computePeriodWindows({
          today: TODAY,
          startsOn: '2026-12-01',
          paidPeriods: [
            { startsOn: '2027-01-10', endsOn: '2027-01-20' },
            { startsOn: '2027-03-01', endsOn: '2027-03-05' },
          ],
        }).end,
      ).toEqual({
        earliest: '2026-12-01',
        latest: '2027-01-09',
        unavailable: [
          { from: '2027-01-10', to: '2027-12-01', reason: 'overlap' },
        ],
      });
    });

    test('開始日より前の決済済みの期間は終了日の範囲に影響しない', () => {
      expect(
        computePeriodWindows({
          today: TODAY,
          startsOn: '2026-12-11',
          paidPeriods: [{ startsOn: '2026-12-01', endsOn: '2026-12-10' }],
        }).end,
      ).toEqual({
        earliest: '2026-12-11',
        latest: '2027-12-11',
        unavailable: [],
      });
    });

    test('翌日に始まる期間と隣り合う開始日では、終了日は開始日の1日だけを選べる', () => {
      expect(
        computePeriodWindows({
          today: TODAY,
          startsOn: '2026-12-01',
          paidPeriods: [{ startsOn: '2026-12-02', endsOn: '2026-12-10' }],
        }).end,
      ).toEqual({
        earliest: '2026-12-01',
        latest: '2026-12-01',
        unavailable: [
          { from: '2026-12-02', to: '2027-12-01', reason: 'overlap' },
        ],
      });
    });

    test('開始日+365日に始まる期間は開始日+365日の1日だけを選べない', () => {
      expect(
        computePeriodWindows({
          today: TODAY,
          startsOn: '2026-12-01',
          paidPeriods: [{ startsOn: '2027-12-01', endsOn: '2027-12-05' }],
        }).end,
      ).toEqual({
        earliest: '2026-12-01',
        latest: '2027-11-30',
        unavailable: [
          { from: '2027-12-01', to: '2027-12-01', reason: 'overlap' },
        ],
      });
    });

    test('開始日+365日より後に始まる期間で範囲を作らない', () => {
      expect(
        computePeriodWindows({
          today: TODAY,
          startsOn: '2026-12-01',
          paidPeriods: [{ startsOn: '2027-12-02', endsOn: '2027-12-05' }],
        }).end,
      ).toEqual({
        earliest: '2026-12-01',
        latest: '2027-12-01',
        unavailable: [],
      });
    });

    test('今日から365日後の開始日では終了日の範囲が開始日の365日後まで伸びる', () => {
      expect(
        computePeriodWindows({
          today: TODAY,
          startsOn: TODAY_PLUS_365,
          paidPeriods: [],
        }).end,
      ).toEqual({
        earliest: TODAY_PLUS_365,
        latest: '2028-11-17',
        unavailable: [],
      });
    });
  });

  describe('選べない開始日', () => {
    test('開始日の当日に始まる決済済みの期間があれば終了日の範囲を返さない', () => {
      expect(
        computePeriodWindows({
          today: TODAY,
          startsOn: '2026-12-01',
          paidPeriods: [{ startsOn: '2026-12-01', endsOn: '2026-12-10' }],
        }).end,
      ).toBeNull();
    });

    test('前日に終わる決済済みの期間と隣り合う開始日は選べる', () => {
      expect(
        computePeriodWindows({
          today: TODAY,
          startsOn: '2026-12-11',
          paidPeriods: [{ startsOn: '2026-12-01', endsOn: '2026-12-10' }],
        }).end,
      ).not.toBeNull();
    });

    test.each([
      ['決済済みの期間の中', '2026-12-05'],
      ['決済済みの期間の終了日', '2026-12-10'],
      ['今日より前', '2026-11-17'],
      ['今日から366日後', TODAY_PLUS_366],
    ])('%sの開始日では終了日の範囲を返さない', (_, startsOn) => {
      const windows = computePeriodWindows({
        today: TODAY,
        startsOn,
        paidPeriods: [{ startsOn: '2026-12-01', endsOn: '2026-12-10' }],
      });
      expect(windows.end).toBeNull();
      expect(windows.start).toEqual({
        earliest: TODAY,
        latest: TODAY_PLUS_365,
        unavailable: [
          { from: '2026-12-01', to: '2026-12-10', reason: 'overlap' },
        ],
      });
    });

    test.each(['2026-02-29', '2026-12-1'])(
      '実在しない日付や形の違う開始日%sはRangeErrorを投げる',
      (startsOn) => {
        expect(() =>
          computePeriodWindows({ today: TODAY, startsOn, paidPeriods: [] }),
        ).toThrow(RangeError);
      },
    );
  });
});
