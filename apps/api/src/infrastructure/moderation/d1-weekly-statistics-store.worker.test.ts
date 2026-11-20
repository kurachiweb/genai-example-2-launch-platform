import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { moderationWeeklyStatistics } from '../../../db/schema/moderation/moderation-weekly-statistics.ts';
import { isUppercaseUlid } from '../../../lib/core/ids/uppercase-ulid.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import type {
  WeeklyStatisticsRow,
  WeeklyStatisticsStore,
} from '../../application/moderation/ports.ts';
import { D1WeeklyStatisticsStore } from './d1-weekly-statistics-store.ts';

const db = createDatabase(env.DB);

const store: WeeklyStatisticsStore = new D1WeeklyStatisticsStore(db);

const COMPUTED_AT = new Date('2026-11-18T12:21:00.000Z');
const RECOMPUTED_AT = new Date('2026-11-19T12:21:00.000Z');

function weekOf(value: string): BusinessDate {
  return parseBusinessDate(value);
}

function rowOf(
  weekStart: string,
  overrides: Partial<Omit<WeeklyStatisticsRow, 'weekStart'>> = {},
): WeeklyStatisticsRow {
  return {
    weekStart: weekOf(weekStart),
    netRevenue: 12_345,
    usersTotal: 120,
    productsTotal: 45,
    qualifierMatches: 18,
    upvotes: 640,
    finalized: false,
    computedAt: COMPUTED_AT,
    ...overrides,
  };
}

async function readRows() {
  return db
    .select({
      id: moderationWeeklyStatistics.id,
      weekStart: moderationWeeklyStatistics.weekStart,
      upvotes: moderationWeeklyStatistics.upvotes,
      finalized: moderationWeeklyStatistics.finalized,
      computedAt: moderationWeeklyStatistics.computedAt,
    })
    .from(moderationWeeklyStatistics)
    .orderBy(asc(moderationWeeklyStatistics.weekStart));
}

beforeEach(async () => {
  await db.delete(moderationWeeklyStatistics);
});

describe('D1WeeklyStatisticsStore.upsert', () => {
  test('新しい週の行をULIDの主キーで作り、5つの値と確定の有無と集計日時を読み戻せる', async () => {
    const previous = rowOf('2026-11-09', {
      netRevenue: -250,
      finalized: true,
    });
    const current = rowOf('2026-11-16');

    await store.upsert([previous, current]);

    const rows = await readRows();
    expect(rows.map((row) => isUppercaseUlid(row.id))).toStrictEqual([
      true,
      true,
    ]);
    await expect(store.listRecent(27)).resolves.toStrictEqual([
      previous,
      current,
    ]);
  });

  test('未確定の週を集計し直すと値を上書きし、2回実行しても行は1つで主キーを保つ', async () => {
    await store.upsert([rowOf('2026-11-16', { upvotes: 640 })]);
    const [before] = await readRows();

    await store.upsert([
      rowOf('2026-11-16', { upvotes: 700, computedAt: RECOMPUTED_AT }),
    ]);

    expect(await readRows()).toStrictEqual([
      {
        id: before?.id,
        weekStart: '2026-11-16',
        upvotes: 700,
        finalized: false,
        computedAt: RECOMPUTED_AT,
      },
    ]);
  });

  test('未確定の週を確定の値で上書きすると確定する', async () => {
    await store.upsert([rowOf('2026-11-09', { upvotes: 500 })]);

    await store.upsert([
      rowOf('2026-11-09', {
        upvotes: 610,
        finalized: true,
        computedAt: RECOMPUTED_AT,
      }),
    ]);

    await expect(store.listRecent(27)).resolves.toStrictEqual([
      rowOf('2026-11-09', {
        upvotes: 610,
        finalized: true,
        computedAt: RECOMPUTED_AT,
      }),
    ]);
  });

  test.each([
    ['未確定の値', false],
    ['確定の値', true],
  ])(
    '確定した週は%sで集計し直しても書き換えず、行は1つで主キーを保つ',
    async (_label, finalized) => {
      const finalizedRow = rowOf('2026-11-09', {
        upvotes: 610,
        finalized: true,
      });
      await store.upsert([finalizedRow]);
      const [before] = await readRows();

      await store.upsert([
        rowOf('2026-11-09', {
          netRevenue: 99_999,
          usersTotal: 999,
          productsTotal: 999,
          qualifierMatches: 999,
          upvotes: 999,
          finalized,
          computedAt: RECOMPUTED_AT,
        }),
      ]);

      const rows = await readRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(before?.id);
      await expect(store.listRecent(27)).resolves.toStrictEqual([finalizedRow]);
    },
  );

  test('確定した前週を飛ばし、同じ呼び出しの今週だけを上書きする', async () => {
    const finalizedPrevious = rowOf('2026-11-09', { finalized: true });
    await store.upsert([finalizedPrevious, rowOf('2026-11-16')]);

    await store.upsert([
      rowOf('2026-11-09', { upvotes: 1, finalized: true }),
      rowOf('2026-11-16', { upvotes: 720, computedAt: RECOMPUTED_AT }),
    ]);

    await expect(store.listRecent(27)).resolves.toStrictEqual([
      finalizedPrevious,
      rowOf('2026-11-16', { upvotes: 720, computedAt: RECOMPUTED_AT }),
    ]);
  });

  test('空の配列では何も書かない', async () => {
    await store.upsert([]);

    expect(await readRows()).toStrictEqual([]);
  });
});

describe('D1WeeklyStatisticsStore.findFinalized', () => {
  test('確定した週だけ真を返し、未確定の週と行の無い週は偽を返す', async () => {
    await store.upsert([
      rowOf('2026-11-09', { finalized: true }),
      rowOf('2026-11-16'),
    ]);

    await expect(store.findFinalized(weekOf('2026-11-09'))).resolves.toBe(true);
    await expect(store.findFinalized(weekOf('2026-11-16'))).resolves.toBe(
      false,
    );
    await expect(store.findFinalized(weekOf('2026-11-02'))).resolves.toBe(
      false,
    );
  });
});

describe('D1WeeklyStatisticsStore.listRecent', () => {
  test('行が無ければ空の配列を返す', async () => {
    await expect(store.listRecent(27)).resolves.toStrictEqual([]);
  });

  test('新しい週から件数の上限までを、週の古い順に返す', async () => {
    await store.upsert([
      rowOf('2026-11-16'),
      rowOf('2026-10-26', { finalized: true }),
      rowOf('2026-11-09', { finalized: true }),
      rowOf('2026-11-02', { finalized: true }),
    ]);

    const rows = await store.listRecent(3);

    expect(rows.map((row) => row.weekStart)).toStrictEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ]);
  });

  test('年をまたぐ週も週の開始日の順に並べる', async () => {
    await store.upsert([
      rowOf('2027-01-04'),
      rowOf('2026-12-28', { finalized: true }),
    ]);

    const rows = await store.listRecent(27);

    expect(rows.map((row) => row.weekStart)).toStrictEqual([
      '2026-12-28',
      '2027-01-04',
    ]);
  });

  test('確定できないまま後の週に追い越された週を返さず、件数の上限に数えない', async () => {
    await store.upsert([
      rowOf('2026-10-19', { finalized: true }),
      rowOf('2026-10-26', { finalized: true }),
      rowOf('2026-11-02'),
      rowOf('2026-11-09', { finalized: true }),
      rowOf('2026-11-16'),
    ]);

    const rows = await store.listRecent(3);

    expect(
      rows.map((row) => [row.weekStart, row.finalized] as const),
    ).toStrictEqual([
      ['2026-10-26', true],
      ['2026-11-09', true],
      ['2026-11-16', false],
    ]);
  });

  test('最も新しい週が確定していれば、確定した週だけを返す', async () => {
    await store.upsert([
      rowOf('2026-11-02'),
      rowOf('2026-11-09', { finalized: true }),
    ]);

    const rows = await store.listRecent(27);

    expect(
      rows.map((row) => [row.weekStart, row.finalized] as const),
    ).toStrictEqual([['2026-11-09', true]]);
  });
});
