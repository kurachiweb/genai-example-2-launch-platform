import { describe, expect, test } from 'bun:test';

import {
  chartAxisFormatOf,
  chartPointsOf,
  chartWeekTickOf,
} from './statistics-chart-values.ts';

describe('chartWeekTickOf', () => {
  test.each([
    ['2026-11-16', '11/16'],
    ['2026-05-04', '5/4'],
    ['2027-01-04', '1/4'],
  ])('週の開始日%sを年と曜日を省いた「%s」にする', (weekStart, expected) => {
    expect(chartWeekTickOf(weekStart)).toBe(expected);
  });
});

describe('chartPointsOf', () => {
  test('合計収益はセントをドルに直し、週の古い順のまま点にする', () => {
    expect(
      chartPointsOf({
        key: 'netRevenue',
        points: [
          { weekStart: '2026-11-09', value: 123_450 },
          { weekStart: '2026-11-16', value: 900 },
        ],
      }),
    ).toStrictEqual([
      { weekStart: '2026-11-09', value: 1_234.5 },
      { weekStart: '2026-11-16', value: 9 },
    ]);
  });

  test('件数の指標は値をそのまま点にする', () => {
    expect(
      chartPointsOf({
        key: 'users',
        points: [
          { weekStart: '2026-11-09', value: 1_234 },
          { weekStart: '2026-11-16', value: 1_240 },
        ],
      }),
    ).toStrictEqual([
      { weekStart: '2026-11-09', value: 1_234 },
      { weekStart: '2026-11-16', value: 1_240 },
    ]);
  });
});

describe('chartAxisFormatOf', () => {
  const format = (
    key: Parameters<typeof chartAxisFormatOf>[0],
    value: number,
  ): string =>
    new Intl.NumberFormat('ja-JP', chartAxisFormatOf(key)).format(value);

  test('合計収益の目盛りは小数点以下を出さないドルの金額にする', () => {
    expect(format('netRevenue', 1_234)).toBe('$1,234');
    expect(format('netRevenue', 0)).toBe('$0');
  });

  test.each(['users', 'products', 'qualifierMatches', 'upvotes'] as const)(
    '%sの目盛りは3桁区切りの数にする',
    (key) => {
      expect(format(key, 1_234)).toBe('1,234');
    },
  );
});
