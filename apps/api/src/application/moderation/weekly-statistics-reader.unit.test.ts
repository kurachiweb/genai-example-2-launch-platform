import { describe, expect, test } from 'bun:test';

import { STATISTICS_WEEKS_SHOWN } from '../../../common-lib/moderation/moderation-actions.ts';
import {
  addBusinessDays,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type { WeeklyStatisticsRow, WeeklyStatisticsStore } from './ports.ts';
import { DefaultWeeklyStatisticsReader } from './weekly-statistics-reader.ts';

const FIRST_WEEK = parseBusinessDate('2026-05-04');

function rowOf(
  index: number,
  finalized: boolean,
  computedAt = new Date(Date.UTC(2026, 4, 11 + index * 7, 12, 21)),
): WeeklyStatisticsRow {
  return {
    weekStart: addBusinessDays(FIRST_WEEK, index * 7),
    netRevenue: index * 100,
    usersTotal: index * 10,
    productsTotal: index * 3,
    qualifierMatches: index,
    upvotes: index * 20,
    finalized,
    computedAt,
  };
}

function finalizedRows(count: number): WeeklyStatisticsRow[] {
  return Array.from({ length: count }, (_, index) => rowOf(index, true));
}

function createReader(rows: readonly WeeklyStatisticsRow[]) {
  const limits: number[] = [];
  const store: Pick<WeeklyStatisticsStore, 'listRecent'> = {
    listRecent: (limit) => {
      limits.push(limit);
      return Promise.resolve(rows.slice(-limit));
    },
  };
  const reader = new DefaultWeeklyStatisticsReader(
    store as WeeklyStatisticsStore,
  );
  return { reader, limits };
}

describe('DefaultWeeklyStatisticsReader', () => {
  test('ストアから表示の週数より1つ多い27行を、集計をやり直さずに読む', async () => {
    const { reader, limits } = createReader([]);

    await reader.read();

    expect(STATISTICS_WEEKS_SHOWN).toBe(26);
    expect(limits).toEqual([27]);
  });

  test('確定した直近26週と集計中の今週を、週の古い順に返す', async () => {
    const current = rowOf(26, false);
    const rows = [...finalizedRows(26), current];
    const { reader } = createReader(rows);

    const statistics = await reader.read();

    expect(statistics.weeks).toEqual(rows);
    expect(statistics.weeks).toHaveLength(27);
    expect(statistics.weeks.at(-1)).toEqual(current);
  });

  test('最新の行が確定済みのときは、確定した週を直近26週に切って返す', async () => {
    const rows = finalizedRows(27);
    const { reader } = createReader(rows);

    const statistics = await reader.read();

    expect(statistics.weeks).toEqual(rows.slice(1));
    expect(statistics.weeks).toHaveLength(26);
  });

  test('集計した週が26週に満たないときは、ある行だけを返す', async () => {
    const rows = [rowOf(0, true), rowOf(1, false)];
    const { reader } = createReader(rows);

    const statistics = await reader.read();

    expect(statistics.weeks).toEqual(rows);
  });

  test('最後の集計日時は、返す週の集計日時のうち最も新しいものである', async () => {
    const latest = new Date('2026-11-20T12:21:00.000Z');
    const rows = [
      rowOf(0, true, new Date('2026-11-16T12:21:00.000Z')),
      rowOf(1, false, latest),
    ];
    const { reader } = createReader(rows);

    const statistics = await reader.read();

    expect(statistics.lastComputedAt).toEqual(latest);
  });

  test('一度も集計していないときは、週の一覧が空で最後の集計日時がnullである', async () => {
    const { reader } = createReader([]);

    const statistics = await reader.read();

    expect(statistics).toEqual({ weeks: [], lastComputedAt: null });
  });
});
