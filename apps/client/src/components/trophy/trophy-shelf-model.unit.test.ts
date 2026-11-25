import { describe, expect, test } from 'bun:test';

import {
  trophyOf,
  WEEK_37_TROPHY,
  WEEK_45_TROPHY,
  WEEK_48_LAST_YEAR_TROPHY,
  YEAR_2025_TROPHY,
} from './trophy-fixtures.ts';
import { orderTrophies, trophyAwardedDateOf } from './trophy-shelf-model.ts';

describe('orderTrophies', () => {
  test('Product of the Yearを先頭に置き、同じ種類は受賞が新しい順に並べる', () => {
    const year2024 = trophyOf({
      kind: 'YEAR',
      period: '2024',
      periodLabel: '2024年',
      awardedAt: '2025-01-11T07:40:00.000Z',
    });

    expect(
      orderTrophies([
        WEEK_48_LAST_YEAR_TROPHY,
        year2024,
        WEEK_37_TROPHY,
        YEAR_2025_TROPHY,
        WEEK_45_TROPHY,
      ]),
    ).toStrictEqual([
      YEAR_2025_TROPHY,
      year2024,
      WEEK_45_TROPHY,
      WEEK_37_TROPHY,
      WEEK_48_LAST_YEAR_TROPHY,
    ]);
  });

  test('受け取った配列を変えない', () => {
    const trophies = Object.freeze([WEEK_37_TROPHY, YEAR_2025_TROPHY]);

    expect(orderTrophies(trophies)).toStrictEqual([
      YEAR_2025_TROPHY,
      WEEK_37_TROPHY,
    ]);
    expect(trophies).toStrictEqual([WEEK_37_TROPHY, YEAR_2025_TROPHY]);
  });
});

describe('trophyAwardedDateOf', () => {
  test('受賞の日時を業務時刻の暦日にする', () => {
    expect(trophyAwardedDateOf('2026-09-19T07:40:00.000Z')).toBe('2026-09-18');
    expect(trophyAwardedDateOf('2026-09-19T08:00:00.000Z')).toBe('2026-09-19');
  });

  test('時差を含まない日時はRangeErrorにする', () => {
    expect(() => trophyAwardedDateOf('2026-09-19T07:40:00')).toThrow(
      RangeError,
    );
  });
});
