import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import {
  db,
  insertLaunches,
  insertProducts,
  insertUser,
  T0,
} from '../product/testing/product-fixtures.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_WINDOW,
  weekEntryIdOf,
  type WeekEntryFixture,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';

const DRAW_AT = WEEK_WINDOW.drawAt;

const LATER = new Date(DRAW_AT.getTime() + 60_000);

const PURCHASE_ID = '01JD0PVRCHASE0000000000001';

const OWNER = 1;

const store = new D1WeekTournamentStore(db);

async function readTournamentRow(index: number) {
  const [row] = await db
    .select({
      status: weekTournaments.status,
      drawStartedAt: weekTournaments.drawStartedAt,
      updatedAt: weekTournaments.updatedAt,
    })
    .from(weekTournaments)
    .where(eq(weekTournaments.id, weekTournamentIdOf(index)));
  return row;
}

function entryOf(
  index: number,
  columns: WeekEntryFixture['columns'] = {},
  tournament = 1,
): WeekEntryFixture {
  return {
    index,
    tournament,
    launch: index,
    product: index,
    owner: OWNER,
    columns,
  };
}

// 投稿者1のプロダクトを、同じ番号のローンチ付きで作る
async function seedProducts(indexes: readonly number[]): Promise<void> {
  await insertProducts(indexes, OWNER);
  await insertLaunches(
    indexes.map((index) => ({ index, productIndex: index })),
  );
}

const ENTITLED_BY_PAYMENT = {
  status: 'entitled',
  entitlementSource: 'payment',
  purchaseId: PURCHASE_ID,
  entitledAt: T0,
} as const;

const DRAWN = {
  status: 'drawn',
  entitlementSource: 'ultras',
  entitledAt: T0,
  closedAt: DRAW_AT,
} as const;

beforeEach(async () => {
  await clearWeekTournamentTables();
  await insertUser(OWNER);
});

describe('D1WeekTournamentStore.freeze', () => {
  beforeEach(async () => {
    await insertWeekTournaments([
      { index: 1 },
      { index: 2, weekStart: '2026-11-09' },
    ]);
  });

  test('凍結前の週に凍結の日時と組み合わせ決定中を記録し、trueを返す', async () => {
    await expect(store.freeze(weekTournamentIdOf(1), DRAW_AT)).resolves.toBe(
      true,
    );

    await expect(readTournamentRow(1)).resolves.toEqual({
      status: 'drawing',
      drawStartedAt: DRAW_AT,
      updatedAt: DRAW_AT,
    });
    await expect(readTournamentRow(2)).resolves.toEqual({
      status: 'open',
      drawStartedAt: null,
      updatedAt: T0,
    });
  });

  test('凍結済みの週は条件の不一致で凍結の日時を変えず、falseを返す', async () => {
    await store.freeze(weekTournamentIdOf(1), DRAW_AT);

    await expect(store.freeze(weekTournamentIdOf(1), LATER)).resolves.toBe(
      false,
    );

    await expect(readTournamentRow(1)).resolves.toEqual({
      status: 'drawing',
      drawStartedAt: DRAW_AT,
      updatedAt: DRAW_AT,
    });
  });

  test('凍結の後に組み合わせを記録した週の状態を組み合わせ決定中へ戻さない', async () => {
    await db
      .update(weekTournaments)
      .set({ status: 'in_progress', drawStartedAt: DRAW_AT })
      .where(eq(weekTournaments.id, weekTournamentIdOf(1)));

    await expect(store.freeze(weekTournamentIdOf(1), LATER)).resolves.toBe(
      false,
    );

    await expect(readTournamentRow(1)).resolves.toMatchObject({
      status: 'in_progress',
      drawStartedAt: DRAW_AT,
    });
  });

  test('無い週はfalseを返す', async () => {
    await expect(store.freeze(weekTournamentIdOf(9), DRAW_AT)).resolves.toBe(
      false,
    );
  });
});

describe('D1WeekTournamentStore.listEntriesForClassification', () => {
  beforeEach(async () => {
    await insertWeekTournaments([
      { index: 1 },
      { index: 2, weekStart: '2026-11-09' },
    ]);
    await seedProducts([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('その週の受付中・資格を得た枠だけを、枠のIDの昇順で件数の上限まで返す', async () => {
    await insertWeekEntries([
      entryOf(5, ENTITLED_BY_PAYMENT),
      entryOf(1),
      entryOf(3, DRAWN),
      entryOf(4, { status: 'expired', closeReason: 'deadline' }),
      entryOf(6, {
        status: 'forfeited',
        closeReason: 'deleted',
        refundStatus: 'not_needed',
      }),
      entryOf(7, { status: 'excluded', closeReason: 'hidden_or_suspended' }),
      entryOf(8, { status: 'expired', closeReason: 'late_entry' }),
      entryOf(2, {}, 2),
      entryOf(9),
    ]);

    const entries = await store.listEntriesForClassification(
      weekTournamentIdOf(1),
      undefined,
      2,
    );

    expect(entries.map(({ entryId }) => entryId)).toEqual([
      weekEntryIdOf(1),
      weekEntryIdOf(5),
    ]);
    expect(entries[1]).toMatchObject({
      status: 'entitled',
      entitlementSource: 'payment',
      purchaseId: PURCHASE_ID,
    });
  });

  test('直前のページの最後の枠のIDより後の枠から返す', async () => {
    await insertWeekEntries([entryOf(1), entryOf(2), entryOf(3), entryOf(4)]);

    const entries = await store.listEntriesForClassification(
      weekTournamentIdOf(1),
      weekEntryIdOf(2),
      10,
    );

    expect(entries.map(({ entryId }) => entryId)).toEqual([
      weekEntryIdOf(3),
      weekEntryIdOf(4),
    ]);
  });

  test('分類の対象の枠が無ければ空の一覧を返す', async () => {
    await insertWeekEntries([entryOf(1, DRAWN)]);

    await expect(
      store.listEntriesForClassification(weekTournamentIdOf(1), undefined, 10),
    ).resolves.toEqual([]);
  });
});

describe('D1WeekTournamentStore.listDrawnEntries', () => {
  beforeEach(async () => {
    await insertWeekTournaments([
      { index: 1 },
      { index: 2, weekStart: '2026-11-09' },
    ]);
    await seedProducts([1, 2, 3, 4, 5]);
  });

  test('その週の組み合わせの対象の枠だけを、紐付けを解除した枠も含めて枠のIDの昇順で返す', async () => {
    await insertWeekEntries([
      entryOf(4, DRAWN),
      entryOf(1, ENTITLED_BY_PAYMENT),
      { ...entryOf(3, DRAWN), launch: null, product: null, owner: null },
      entryOf(2, { status: 'expired', closeReason: 'deadline' }),
      entryOf(5, DRAWN, 2),
    ]);

    const entries = await store.listDrawnEntries(weekTournamentIdOf(1));

    expect(entries.map(({ entryId }) => entryId)).toEqual([
      weekEntryIdOf(3),
      weekEntryIdOf(4),
    ]);
    expect(entries[0]).toMatchObject({
      status: 'drawn',
      launchId: null,
      productId: null,
      ownerUserId: null,
    });
  });

  test('組み合わせの対象の枠が無ければ空の一覧を返す', async () => {
    await insertWeekEntries([entryOf(1)]);

    await expect(
      store.listDrawnEntries(weekTournamentIdOf(1)),
    ).resolves.toEqual([]);
  });
});
