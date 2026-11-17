import { beforeEach, describe, expect, test } from 'vitest';

import { YEAR_MAX_PARTICIPANTS } from '../../core/year-tournament/year-schedule.ts';
import { db, insertUser } from '../product/testing/product-fixtures.ts';
import {
  ENTITLED_BY_PAYMENT,
  PLAIN_OWNER,
  PURCHASE_ID,
  seedProducts,
} from '../week-tournament/testing/draw-service-fixtures.ts';
import { D1YearEntryStore } from './d1-year-entry-store.ts';
import {
  createDrawService,
  DRAW_AT,
  entryOf,
  readEntry,
} from './testing/year-draw-fixtures.ts';
import {
  championWeekTournamentIdOf,
  clearYearTournamentTables,
  insertYearEntries,
  insertYearTournaments,
  YEAR,
  type YearEntryFixture,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';

const LATER = new Date(DRAW_AT.getTime() + 600_000);

// 最も古いWeek優勝の日時(2026-11-23の23:45)。枠の番号が1増えるごとに1分新しくなる
const OLDEST_AWARDED_AT = new Date('2026-11-24T07:45:00.000Z');

// 101〜165: 可視の決済の参加資格(65件)、166〜200: 特典の無い受付中(35件)
const ENTITLED_INDEXES = Array.from(
  { length: YEAR_MAX_PARTICIPANTS + 1 },
  (_, offset) => offset + 101,
);
const AWAITING_INDEXES = Array.from(
  { length: 35 },
  (_, offset) => offset + 166,
);

function awardedAtOf(index: number): Date {
  return new Date(OLDEST_AWARDED_AT.getTime() + (index - 101) * 60_000);
}

async function seedEntries(
  columnsOf: (index: number) => YearEntryFixture['columns'] = () => ({}),
): Promise<void> {
  await insertYearEntries([
    ...ENTITLED_INDEXES.map((index) =>
      entryOf(index, PLAIN_OWNER, {
        ...ENTITLED_BY_PAYMENT,
        awardedAt: awardedAtOf(index),
        ...columnsOf(index),
      }),
    ),
    ...AWAITING_INDEXES.map((index) => entryOf(index, PLAIN_OWNER)),
  ]);
}

async function drawnEntryIds(): Promise<string[]> {
  const drawn = await new D1YearEntryStore(db).listDrawn(YEAR);
  return drawn.map(({ entryId }) => entryId);
}

beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(PLAIN_OWNER);
  await insertYearTournaments([{ index: 1 }]);
  await seedProducts(PLAIN_OWNER, [...ENTITLED_INDEXES, ...AWAITING_INDEXES]);
});

describe('YearTournamentDrawService.drawDue(参加数の上限)', () => {
  test('参加資格を得た可視の枠が65件なら、Week優勝の日時が最も古い1件を上限による除外にして返金待ちにし、残りの64件を組み合わせの対象にする', async () => {
    await seedEntries();
    const { service, entries } = createDrawService();

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [YEAR],
      failed: [],
    });

    expect(entries.candidatePageSizes).toEqual([90, 10]);
    expect(entries.overCapacity).toEqual([[yearEntryIdOf(101)]]);
    await expect(readEntry(101)).resolves.toEqual({
      status: 'excluded',
      closeReason: 'over_capacity',
      entitlementSource: 'payment',
      purchaseId: PURCHASE_ID,
      entitledAt: expect.any(Date) as unknown,
      closedAt: DRAW_AT,
      classifiedYear: YEAR,
      refundStatus: 'pending',
    });
    await expect(drawnEntryIds()).resolves.toEqual(
      ENTITLED_INDEXES.slice(1).map(yearEntryIdOf),
    );
    await expect(readEntry(166)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'deadline',
    });
  });

  test('凍結済みの年の再実行は同じ64件を選び、除外を書き換えない', async () => {
    await seedEntries();
    await createDrawService().service.drawDue(DRAW_AT);
    const { service, entries } = createDrawService();

    await expect(service.drawDue(LATER)).resolves.toEqual({
      drawn: [YEAR],
      failed: [],
    });

    expect(entries.overCapacity).toEqual([[]]);
    await expect(readEntry(101)).resolves.toMatchObject({
      status: 'excluded',
      closeReason: 'over_capacity',
      closedAt: DRAW_AT,
    });
    await expect(drawnEntryIds()).resolves.toEqual(
      ENTITLED_INDEXES.slice(1).map(yearEntryIdOf),
    );
  });

  test('最も古いWeek優勝の日時が同じ枠は、WeekトーナメントのIDの小さい枠を残す', async () => {
    await seedEntries((index) => {
      if (index === 101) {
        return { weekTournamentId: championWeekTournamentIdOf(999) };
      }
      return index === 102 ? { awardedAt: OLDEST_AWARDED_AT } : {};
    });
    const { service, entries } = createDrawService();

    await service.drawDue(DRAW_AT);

    expect(entries.overCapacity).toEqual([[yearEntryIdOf(101)]]);
    await expect(readEntry(102)).resolves.toMatchObject({ status: 'drawn' });
  });

  test('参加資格を得た可視の枠が64件なら、除外せずにすべてを組み合わせの対象にする', async () => {
    await seedEntries((index) =>
      index === 101
        ? {
            status: 'awaiting_payment',
            entitlementSource: null,
            purchaseId: null,
            entitledAt: null,
          }
        : {},
    );
    const { service, entries } = createDrawService();

    await service.drawDue(DRAW_AT);

    expect(entries.overCapacity).toEqual([[]]);
    await expect(drawnEntryIds()).resolves.toHaveLength(YEAR_MAX_PARTICIPANTS);
  });
});
