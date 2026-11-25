import { describe, expect, test } from 'bun:test';

import type { AdminStatisticsWeekView } from '../../../graphql/admin-weekly-statistics.ts';
import {
  STATISTICS_METRIC_KEYS,
  statisticsSeriesOf,
} from './statistics-series.ts';

const weekOf = (
  weekStart: string,
  finalized: boolean,
  base: number,
): AdminStatisticsWeekView => ({
  weekStart,
  finalized,
  netRevenue: { amount: base * 100, currency: 'usd' },
  users: base + 1,
  products: base + 2,
  qualifierMatches: base + 3,
  upvotes: base + 4,
});

describe('statisticsSeriesOf', () => {
  test('指標は合計収益・ユーザー数・プロダクト数・予選実施数・Upvote数の順に並べる', () => {
    expect(STATISTICS_METRIC_KEYS).toStrictEqual([
      'netRevenue',
      'users',
      'products',
      'qualifierMatches',
      'upvotes',
    ]);
  });

  test('直近の確定した週の各指標の値と、7日前に始まる週からの増減を返す', () => {
    const previous = weekOf('2026-11-02', true, 100);
    const latest: AdminStatisticsWeekView = {
      weekStart: '2026-11-09',
      finalized: true,
      netRevenue: { amount: 11_234, currency: 'usd' },
      users: 113,
      products: 99,
      qualifierMatches: 103,
      upvotes: 104,
    };

    const series = statisticsSeriesOf([
      previous,
      latest,
      weekOf('2026-11-16', false, 300),
    ]);

    expect(series.latestFinalized).toStrictEqual({
      weekStart: '2026-11-09',
      metrics: [
        { key: 'netRevenue', value: 11_234, delta: 1_234 },
        { key: 'users', value: 113, delta: 12 },
        { key: 'products', value: 99, delta: -3 },
        { key: 'qualifierMatches', value: 103, delta: 0 },
        { key: 'upvotes', value: 104, delta: 0 },
      ],
    });
  });

  test('7日前に始まる週の行が欠けていれば、増減を持たない', () => {
    const series = statisticsSeriesOf([
      weekOf('2026-10-26', true, 50),
      weekOf('2026-11-09', true, 100),
      weekOf('2026-11-16', false, 300),
    ]);

    expect(series.latestFinalized?.weekStart).toBe('2026-11-09');
    expect(series.latestFinalized?.metrics.map(({ delta }) => delta)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test('最新の行が集計中でも、直近の値はそれより前の確定した週から求める', () => {
    const series = statisticsSeriesOf([
      weekOf('2026-11-02', true, 100),
      weekOf('2026-11-09', false, 200),
    ]);

    expect(series.latestFinalized?.weekStart).toBe('2026-11-02');
    expect(series.latestFinalized?.metrics[1]).toStrictEqual({
      key: 'users',
      value: 101,
      delta: null,
    });
  });

  test('確定した週が無ければ直近の値を持たず、集計中の今週だけを表の行と系列に入れる', () => {
    const series = statisticsSeriesOf([weekOf('2026-11-16', false, 10)]);

    expect(series.latestFinalized).toBeNull();
    expect(series.rows).toStrictEqual([
      {
        weekStart: '2026-11-16',
        inProgress: true,
        values: {
          netRevenue: 1_000,
          users: 11,
          products: 12,
          qualifierMatches: 13,
          upvotes: 14,
        },
      },
    ]);
    expect(series.series.map(({ points }) => points)).toStrictEqual([
      [{ weekStart: '2026-11-16', value: 1_000 }],
      [{ weekStart: '2026-11-16', value: 11 }],
      [{ weekStart: '2026-11-16', value: 12 }],
      [{ weekStart: '2026-11-16', value: 13 }],
      [{ weekStart: '2026-11-16', value: 14 }],
    ]);
  });

  test('表の行は新しい週を上にし、確定していない週を集計中にする', () => {
    const series = statisticsSeriesOf([
      weekOf('2026-11-02', true, 100),
      weekOf('2026-11-09', true, 200),
      weekOf('2026-11-16', false, 300),
    ]);

    expect(
      series.rows.map(({ weekStart, inProgress }) => [weekStart, inProgress]),
    ).toStrictEqual([
      ['2026-11-16', true],
      ['2026-11-09', false],
      ['2026-11-02', false],
    ]);
  });

  test('系列は指標ごとに週の古い順の値を持ち、欠けた週を補わない', () => {
    const series = statisticsSeriesOf([
      weekOf('2026-10-26', true, 50),
      weekOf('2026-11-09', true, 100),
      weekOf('2026-11-16', false, 300),
    ]);

    expect(series.series[0]).toStrictEqual({
      key: 'netRevenue',
      points: [
        { weekStart: '2026-10-26', value: 5_000 },
        { weekStart: '2026-11-09', value: 10_000 },
        { weekStart: '2026-11-16', value: 30_000 },
      ],
    });
    expect(series.series[4]).toStrictEqual({
      key: 'upvotes',
      points: [
        { weekStart: '2026-10-26', value: 54 },
        { weekStart: '2026-11-09', value: 104 },
        { weekStart: '2026-11-16', value: 304 },
      ],
    });
  });

  test('行が無ければ、直近の値も表の行も系列の値も持たない', () => {
    const series = statisticsSeriesOf([]);

    expect(series.latestFinalized).toBeNull();
    expect(series.rows).toStrictEqual([]);
    expect(series.series.every(({ points }) => points.length === 0)).toBe(true);
  });

  test('負の純収益の週からの増減も差で求める', () => {
    const series = statisticsSeriesOf([
      {
        ...weekOf('2026-11-02', true, 0),
        netRevenue: { amount: -900, currency: 'usd' },
      },
      {
        ...weekOf('2026-11-09', true, 0),
        netRevenue: { amount: 100, currency: 'usd' },
      },
    ]);

    expect(series.latestFinalized?.metrics[0]).toStrictEqual({
      key: 'netRevenue',
      value: 100,
      delta: 1_000,
    });
  });
});
