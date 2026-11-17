import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
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
import { D1YearEntryStore } from './d1-year-entry-store.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  YEAR,
  type YearEntryFixture,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';

const PURCHASE_ID = '01JD0PVRCHASE0000000000001';

const store = new D1YearEntryStore(db);

const DRAWN = {
  status: 'drawn',
  entitlementSource: 'ultras',
  entitledAt: T0,
  closedAt: T0,
  classifiedYear: YEAR,
} as const;

async function readEntryIds(): Promise<string[]> {
  const rows = await db
    .select({ id: yearTournamentEntries.id })
    .from(yearTournamentEntries)
    .orderBy(yearTournamentEntries.id);
  return rows.map(({ id }) => id);
}

async function readEntryRow(index: number) {
  const [row] = await db
    .select()
    .from(yearTournamentEntries)
    .where(eq(yearTournamentEntries.id, yearEntryIdOf(index)));
  return row;
}

function entryOf(
  index: number,
  product: number,
  owner: number,
  columns: YearEntryFixture['columns'] = {},
): YearEntryFixture {
  return { index, launch: index, product, owner, columns };
}

// 利用者2のプロダクト3はローンチ3〜8に枠を持ち、3と8が組み合わせに入っている。利用者1のプロダクト1も組み合わせに入っている
beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(1);
  await insertUser(2);
  await insertProduct(1, 1);
  await insertLaunch(1, 1);
  await insertProduct(3, 2);
  for (const launch of [3, 4, 5, 6, 7, 8]) {
    await insertLaunch(launch, 3, { outcome: 'won', decidedAt: T0 });
  }
  await insertYearEntries([
    entryOf(1, 1, 1, DRAWN),
    entryOf(3, 3, 2, DRAWN),
    entryOf(4, 3, 2, {
      status: 'excluded',
      closeReason: 'over_capacity',
      closedAt: T0,
      entitlementSource: 'payment',
      purchaseId: PURCHASE_ID,
      entitledAt: T0,
      classifiedYear: YEAR,
      refundStatus: 'requested',
      refundRequestedAt: T0,
      refundNoticeStatus: 'sent',
    }),
    entryOf(5, 3, 2, {
      status: 'expired',
      closeReason: 'late_entry',
      closedAt: T0,
      classifiedYear: YEAR,
      refundStatus: 'not_needed',
    }),
    entryOf(6, 3, 2, {
      status: 'forfeited',
      closeReason: 'deleted',
      closedAt: T0,
      refundStatus: 'not_needed',
    }),
    entryOf(7, 3, 2),
    entryOf(8, 3, 2, { ...DRAWN, classifiedYear: YEAR + 1 }),
  ]);
});

describe('D1YearEntryStore.unlinkOrDeleteByProduct', () => {
  test('プロダクトの組み合わせに入った枠はプロダクト・ローンチ・投稿者の紐付けだけを解除して残し、上限による除外を含むそれ以外の枠を削除して、それぞれの数を返す', async () => {
    const before = await readEntryRow(3);

    await expect(
      store.unlinkOrDeleteByProduct(productIdOf(3)),
    ).resolves.toEqual({ unlinked: 2, deleted: 4 });

    await expect(readEntryIds()).resolves.toEqual([
      yearEntryIdOf(1),
      yearEntryIdOf(3),
      yearEntryIdOf(8),
    ]);
    await expect(readEntryRow(3)).resolves.toEqual({
      ...before,
      launchId: null,
      productId: null,
      ownerUserId: null,
      updatedAt: expect.any(Date) as Date,
    });
    await expect(readEntryRow(8)).resolves.toMatchObject({
      status: 'drawn',
      classifiedYear: YEAR + 1,
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
      yearEntryIdOf(1),
      yearEntryIdOf(3),
      yearEntryIdOf(8),
    ]);
  });

  test('解除の前は、投稿者の物理削除が枠の外部キーの違反で失敗する', async () => {
    await expect(
      db.delete(users).where(eq(users.id, userIdOf(1))),
    ).rejects.toThrow();
  });

  test('紐付けを解除した後の同じプロダクトの再実行では何も変えず、どちらも0を返す', async () => {
    await store.unlinkOrDeleteByProduct(productIdOf(3));
    const before = await Promise.all([1, 3, 8].map(readEntryRow));

    await expect(
      store.unlinkOrDeleteByProduct(productIdOf(3)),
    ).resolves.toEqual({ unlinked: 0, deleted: 0 });

    await expect(Promise.all([1, 3, 8].map(readEntryRow))).resolves.toEqual(
      before,
    );
  });

  test('枠の無いプロダクトでは何も変えず、どちらも0を返す', async () => {
    const indexes = [1, 3, 4, 5, 6, 7, 8];
    const before = await Promise.all(indexes.map(readEntryRow));

    await expect(
      store.unlinkOrDeleteByProduct(productIdOf(9)),
    ).resolves.toEqual({ unlinked: 0, deleted: 0 });

    await expect(Promise.all(indexes.map(readEntryRow))).resolves.toEqual(
      before,
    );
  });

  test('解除と削除を1回の一括の2つの文で行う', async () => {
    const recording = createRecordingDatabase();

    await new D1YearEntryStore(recording.database).unlinkOrDeleteByProduct(
      productIdOf(3),
    );

    expect(recording.placeholderCounts).toHaveLength(2);
    expectWithinBindLimit(recording.placeholderCounts);
  });
});
