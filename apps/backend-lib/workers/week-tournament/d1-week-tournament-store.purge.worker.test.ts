import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import {
  createRecordingDatabase,
  expectWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  weekEntryIdOf,
  type WeekEntryFixture,
} from './testing/week-tournament-fixtures.ts';

const store = new D1WeekTournamentStore(db);

const DRAWN = {
  status: 'drawn',
  entitlementSource: 'ultras',
  entitledAt: T0,
  closedAt: T0,
} as const;

async function readEntryIds(): Promise<string[]> {
  const rows = await db
    .select({ id: weekTournamentEntries.id })
    .from(weekTournamentEntries)
    .orderBy(weekTournamentEntries.id);
  return rows.map(({ id }) => id);
}

async function readEntryRow(index: number) {
  const [row] = await db
    .select()
    .from(weekTournamentEntries)
    .where(eq(weekTournamentEntries.id, weekEntryIdOf(index)));
  return row;
}

function entryOf(
  index: number,
  tournament: number,
  launch: number,
  product: number,
  owner: number,
  columns: WeekEntryFixture['columns'] = {},
): WeekEntryFixture {
  return { index, tournament, launch, product, owner, columns };
}

// 利用者2のプロダクト3は週1〜4に枠を持ち(ローンチ3〜6)、利用者1のプロダクト1は週1で組み合わせに入っている
beforeEach(async () => {
  await clearWeekTournamentTables();
  await insertUser(1);
  await insertUser(2);
  await insertProduct(1, 1);
  await insertLaunch(1, 1);
  await insertProduct(3, 2);
  for (const launch of [3, 4, 5, 6]) {
    await insertLaunch(launch, 3, { outcome: 'won', decidedAt: T0 });
  }
  await insertWeekTournaments([
    { index: 1 },
    { index: 2, weekStart: '2026-11-09' },
    { index: 3, weekStart: '2026-11-02' },
    { index: 4, weekStart: '2026-10-26' },
  ]);
  await insertWeekEntries([
    entryOf(1, 1, 1, 1, 1, DRAWN),
    entryOf(3, 1, 3, 3, 2, DRAWN),
    entryOf(4, 2, 4, 3, 2, {
      status: 'forfeited',
      closeReason: 'deleted',
      refundStatus: 'not_needed',
    }),
    entryOf(5, 3, 5, 3, 2, { status: 'expired', closeReason: 'deadline' }),
    entryOf(6, 4, 6, 3, 2, DRAWN),
  ]);
});

describe('D1WeekTournamentStore.unlinkOrDeleteByProduct', () => {
  test('プロダクトの組み合わせに入った枠はプロダクト・ローンチ・投稿者の紐付けだけを解除して残し、それ以外の枠を削除して、それぞれの数を返す', async () => {
    const before = await readEntryRow(3);

    await expect(
      store.unlinkOrDeleteByProduct(productIdOf(3)),
    ).resolves.toEqual({ unlinked: 2, deleted: 2 });

    await expect(readEntryIds()).resolves.toEqual([
      weekEntryIdOf(1),
      weekEntryIdOf(3),
      weekEntryIdOf(6),
    ]);
    await expect(readEntryRow(3)).resolves.toEqual({
      ...before,
      launchId: null,
      productId: null,
      ownerUserId: null,
      updatedAt: expect.any(Date) as Date,
    });
    await expect(readEntryRow(6)).resolves.toMatchObject({
      status: 'drawn',
      launchId: null,
      productId: null,
      ownerUserId: null,
    });
    await expect(readEntryRow(1)).resolves.toMatchObject({
      launchId: launchIdOf(1),
      productId: productIdOf(1),
      ownerUserId: userIdOf(1),
    });
  });

  test('解除と削除の後は、ローンチ・プロダクト・投稿者を物理削除しても外部キーの違反にならない', async () => {
    await store.unlinkOrDeleteByProduct(productIdOf(3));

    await db
      .delete(productLaunches)
      .where(eq(productLaunches.productId, productIdOf(3)));
    await db.delete(products).where(eq(products.id, productIdOf(3)));
    await db.delete(users).where(eq(users.id, userIdOf(2)));

    await expect(readEntryIds()).resolves.toEqual([
      weekEntryIdOf(1),
      weekEntryIdOf(3),
      weekEntryIdOf(6),
    ]);
  });

  test('枠の無いプロダクトでは何も変えず、どちらも0を返す', async () => {
    const before = await Promise.all([1, 3, 4, 5, 6].map(readEntryRow));

    await expect(
      store.unlinkOrDeleteByProduct(productIdOf(9)),
    ).resolves.toEqual({ unlinked: 0, deleted: 0 });

    await expect(
      Promise.all([1, 3, 4, 5, 6].map(readEntryRow)),
    ).resolves.toEqual(before);
  });

  test('解除と削除を1回の一括の2つの文で行う', async () => {
    const recording = createRecordingDatabase();

    await new D1WeekTournamentStore(recording.database).unlinkOrDeleteByProduct(
      productIdOf(3),
    );

    expect(recording.placeholderCounts).toHaveLength(2);
    expectWithinBindLimit(recording.placeholderCounts);
  });
});

describe('D1WeekTournamentStore.listLaunchIdsByProduct', () => {
  test('プロダクトの枠のローンチを、組み合わせに入った・喪失・期限切れなど枠の状態によらずローンチのIDの昇順で返す', async () => {
    await expect(store.listLaunchIdsByProduct(productIdOf(3))).resolves.toEqual(
      [launchIdOf(3), launchIdOf(4), launchIdOf(5), launchIdOf(6)],
    );
    await expect(store.listLaunchIdsByProduct(productIdOf(1))).resolves.toEqual(
      [launchIdOf(1)],
    );
  });

  test('枠の無いプロダクトと、紐付けを解除した後のプロダクトでは空を返す', async () => {
    await expect(store.listLaunchIdsByProduct(productIdOf(9))).resolves.toEqual(
      [],
    );

    await store.unlinkOrDeleteByProduct(productIdOf(3));

    await expect(store.listLaunchIdsByProduct(productIdOf(3))).resolves.toEqual(
      [],
    );
  });
});
