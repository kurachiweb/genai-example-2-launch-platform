import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertLaunch,
  insertLaunches,
  insertProduct,
  insertProducts,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1YearEntryStore } from './d1-year-entry-store.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  insertYearTournaments,
  YEAR_SCHEDULE,
  type YearEntryFixture,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';

const AT = new Date('2026-11-25T10:00:00.000Z');

const PURCHASE_ID = '01JD0PVRCHASE0000000000001';

const IDS_OVER_ONE_STATEMENT = 95;

const OWNER = 1;

const OTHER_OWNER = 2;

// 2027年の決済期限日(2027-05-24)の前日と当日のWeek優勝
const BEFORE_DEADLINE = '2027-05-23';

const ON_DEADLINE = YEAR_SCHEDULE.deadlineDate;

const ENTITLED_BY_PAYMENT = {
  status: 'entitled',
  entitlementSource: 'payment',
  purchaseId: PURCHASE_ID,
  entitledAt: T0,
} as const;

const ENTITLED_BY_ULTRAS = {
  status: 'entitled',
  entitlementSource: 'ultras',
  entitledAt: T0,
} as const;

const store = new D1YearEntryStore(db);

async function readEntryRow(index: number) {
  const [row] = await db
    .select()
    .from(yearTournamentEntries)
    .where(eq(yearTournamentEntries.id, yearEntryIdOf(index)));
  return row;
}

async function readEntryRows(indexes: readonly number[]) {
  return Promise.all(indexes.map(readEntryRow));
}

// 2027年の組み合わせ決定を始めた(凍結した)状態にする
async function freezeYear2027(): Promise<void> {
  await insertYearTournaments([
    {
      index: 1,
      columns: {
        status: 'drawing',
        drawStartedAt: YEAR_SCHEDULE.drawAt,
        updatedAt: YEAR_SCHEDULE.drawAt,
      },
    },
  ]);
}

// プロダクトを、同じ番号のローンチ付きで作る
async function seedProducts(
  products: readonly { readonly index: number; readonly owner: number }[],
): Promise<void> {
  for (const { index, owner } of products) {
    await insertProduct(index, owner);
    await insertLaunch(index, index);
  }
}

function entryOf(
  index: number,
  columns: YearEntryFixture['columns'] = {},
  { owner = OWNER }: { owner?: number } = {},
): YearEntryFixture {
  return { index, launch: index, product: index, owner, columns };
}

beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(OWNER);
  await insertUser(OTHER_OWNER);
});

describe('D1YearEntryStore.grantByUltras', () => {
  beforeEach(async () => {
    await seedProducts([1, 2, 3, 4].map((index) => ({ index, owner: OWNER })));
  });

  test('指定した受付中の枠に参加資格(Ultras)と資格を得た日時を記録し、枠のIDを昇順で返す', async () => {
    await insertYearTournaments([{ index: 1 }]);
    await insertYearEntries([entryOf(1), entryOf(2), entryOf(3)]);

    await expect(
      store.grantByUltras([yearEntryIdOf(2), yearEntryIdOf(1)], AT),
    ).resolves.toEqual([yearEntryIdOf(1), yearEntryIdOf(2)]);

    await expect(readEntryRows([1, 2, 3])).resolves.toEqual([
      expect.objectContaining({
        status: 'entitled',
        entitlementSource: 'ultras',
        entitledAt: AT,
        closedAt: null,
        closeReason: null,
        refundStatus: 'none',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'entitled',
        entitlementSource: 'ultras',
        entitledAt: AT,
      }),
      expect.objectContaining({
        status: 'awaiting_payment',
        entitlementSource: null,
        entitledAt: null,
        updatedAt: T0,
      }),
    ]);
  });

  test('参加資格を得た枠・終わった枠は条件の不一致で変えず、結果に含めない', async () => {
    await insertYearEntries([
      entryOf(1, ENTITLED_BY_PAYMENT),
      entryOf(2, {
        ...ENTITLED_BY_ULTRAS,
        status: 'drawn',
        classifiedYear: 2027,
        closedAt: T0,
      }),
      entryOf(3, {
        status: 'expired',
        closeReason: 'deadline',
        classifiedYear: 2027,
        closedAt: T0,
      }),
      entryOf(4, {
        status: 'forfeited',
        closeReason: 'withdrawn',
        closedAt: T0,
        refundStatus: 'not_needed',
      }),
    ]);
    const before = await readEntryRows([1, 2, 3, 4]);

    await expect(
      store.grantByUltras([1, 2, 3, 4].map(yearEntryIdOf), AT),
    ).resolves.toEqual([]);

    await expect(readEntryRows([1, 2, 3, 4])).resolves.toEqual(before);
  });

  test('凍結の後は、その年の決済期限日より前のWeek優勝の枠に資格を与えず、決済期限日の当日以降の枠には与える', async () => {
    await freezeYear2027();
    await insertYearEntries([
      entryOf(1),
      entryOf(2, { awardedDate: BEFORE_DEADLINE }),
      entryOf(3, { awardedDate: ON_DEADLINE }),
    ]);
    const before = await readEntryRows([1, 2]);

    await expect(
      store.grantByUltras([1, 2, 3].map(yearEntryIdOf), AT),
    ).resolves.toEqual([yearEntryIdOf(3)]);

    await expect(readEntryRows([1, 2])).resolves.toEqual(before);
    await expect(readEntryRow(3)).resolves.toMatchObject({
      status: 'entitled',
      entitlementSource: 'ultras',
      entitledAt: AT,
    });
  });

  test('空の入力では問い合わせずに空の結果を返す', async () => {
    const recording = createRecordingDatabase();

    await expect(
      new D1YearEntryStore(recording.database).grantByUltras([], AT),
    ).resolves.toEqual([]);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超える枠はバインド変数の上限に収まるよう分けて更新し、すべての枠に資格を与える', async () => {
    const indexes = Array.from(
      { length: IDS_OVER_ONE_STATEMENT },
      (_, offset) => offset + 100,
    );
    await insertProducts(indexes, OWNER);
    await insertLaunches(
      indexes.map((index) => ({ index, productIndex: index })),
    );
    await insertYearEntries(indexes.map((index) => entryOf(index)));
    const recording = createRecordingDatabase();

    const granted = await new D1YearEntryStore(
      recording.database,
    ).grantByUltras(indexes.map(yearEntryIdOf), AT);

    expect(granted).toEqual(indexes.map(yearEntryIdOf));
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('D1YearEntryStore.forfeitByProduct', () => {
  // プロダクト1は以前に勝利したローンチ2と再ローンチ1の枠、プロダクト3は別のプロダクトの枠
  beforeEach(async () => {
    await seedProducts([
      { index: 1, owner: OWNER },
      { index: 3, owner: OWNER },
    ]);
    await insertLaunch(2, 1, {
      launchDate: '2026-11-13',
      outcome: 'won',
      decidedAt: T0,
    });
  });

  function productEntryOf(
    index: number,
    columns: YearEntryFixture['columns'] = {},
  ): YearEntryFixture {
    return { index, launch: index, product: 1, owner: OWNER, columns };
  }

  test('プロダクトの受付中・参加資格の枠を削除による喪失にし、購入があれば返金待ち、無ければ返金不要を記録してIDを返す', async () => {
    await insertYearEntries([
      productEntryOf(1, ENTITLED_BY_PAYMENT),
      productEntryOf(2),
      entryOf(3),
    ]);

    await expect(store.forfeitByProduct(productIdOf(1), AT)).resolves.toEqual([
      yearEntryIdOf(1),
      yearEntryIdOf(2),
    ]);

    await expect(readEntryRows([1, 2, 3])).resolves.toEqual([
      expect.objectContaining({
        status: 'forfeited',
        closeReason: 'deleted',
        closedAt: AT,
        entitlementSource: 'payment',
        purchaseId: PURCHASE_ID,
        classifiedYear: null,
        refundStatus: 'pending',
        refundNoticeStatus: 'none',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'forfeited',
        closeReason: 'deleted',
        closedAt: AT,
        refundStatus: 'not_needed',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'awaiting_payment',
        closeReason: null,
        refundStatus: 'none',
        updatedAt: T0,
      }),
    ]);
  });

  test('Ultrasで参加資格を得た枠は購入が無いため返金不要にする', async () => {
    await insertYearEntries([productEntryOf(1, ENTITLED_BY_ULTRAS)]);

    await expect(store.forfeitByProduct(productIdOf(1), AT)).resolves.toEqual([
      yearEntryIdOf(1),
    ]);

    await expect(readEntryRow(1)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
      entitlementSource: 'ultras',
      refundStatus: 'not_needed',
    });
  });

  test('組み合わせ済み・終わった枠は条件の不一致で変えない', async () => {
    await insertYearEntries([
      productEntryOf(1, {
        ...ENTITLED_BY_PAYMENT,
        status: 'drawn',
        classifiedYear: 2027,
        closedAt: T0,
      }),
      productEntryOf(2, {
        ...ENTITLED_BY_PAYMENT,
        status: 'excluded',
        closeReason: 'over_capacity',
        classifiedYear: 2027,
        closedAt: T0,
        refundStatus: 'requested',
      }),
    ]);
    const before = await readEntryRows([1, 2]);

    await expect(store.forfeitByProduct(productIdOf(1), AT)).resolves.toEqual(
      [],
    );

    await expect(readEntryRows([1, 2])).resolves.toEqual(before);
  });

  test('凍結の後は、その年の決済期限日より前のWeek優勝の枠を変えず、決済期限日の当日以降の枠だけを喪失にする', async () => {
    await freezeYear2027();
    await insertYearEntries([
      productEntryOf(1, {
        ...ENTITLED_BY_PAYMENT,
        awardedDate: BEFORE_DEADLINE,
      }),
      productEntryOf(2, { awardedDate: ON_DEADLINE }),
    ]);
    const before = await readEntryRow(1);

    await expect(store.forfeitByProduct(productIdOf(1), AT)).resolves.toEqual([
      yearEntryIdOf(2),
    ]);

    await expect(readEntryRow(1)).resolves.toEqual(before);
    await expect(readEntryRow(2)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
    });
  });
});

describe('D1YearEntryStore.forfeitByOwner', () => {
  // 利用者1のプロダクト1・2と、利用者2のプロダクト3
  beforeEach(async () => {
    await seedProducts([
      { index: 1, owner: OWNER },
      { index: 2, owner: OWNER },
      { index: 3, owner: OTHER_OWNER },
    ]);
  });

  test('投稿者の受付中・参加資格の枠を退会による喪失にし、購入があれば返金待ち、無ければ返金不要を記録してIDを返す', async () => {
    await insertYearEntries([
      entryOf(1),
      entryOf(2, ENTITLED_BY_PAYMENT),
      entryOf(3, ENTITLED_BY_PAYMENT, { owner: OTHER_OWNER }),
    ]);

    await expect(store.forfeitByOwner(userIdOf(OWNER), AT)).resolves.toEqual([
      yearEntryIdOf(1),
      yearEntryIdOf(2),
    ]);

    await expect(readEntryRows([1, 2, 3])).resolves.toEqual([
      expect.objectContaining({
        status: 'forfeited',
        closeReason: 'withdrawn',
        closedAt: AT,
        refundStatus: 'not_needed',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'forfeited',
        closeReason: 'withdrawn',
        closedAt: AT,
        entitlementSource: 'payment',
        refundStatus: 'pending',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'entitled',
        closeReason: null,
        refundStatus: 'none',
        updatedAt: T0,
      }),
    ]);
  });

  test('組み合わせ済み・終わった枠は条件の不一致で変えない', async () => {
    await insertYearEntries([
      entryOf(1, {
        ...ENTITLED_BY_ULTRAS,
        status: 'drawn',
        classifiedYear: 2027,
        closedAt: T0,
      }),
      entryOf(2, {
        status: 'forfeited',
        closeReason: 'deleted',
        closedAt: T0,
        refundStatus: 'not_needed',
      }),
    ]);
    const before = await readEntryRows([1, 2]);

    await expect(store.forfeitByOwner(userIdOf(OWNER), AT)).resolves.toEqual(
      [],
    );

    await expect(readEntryRows([1, 2])).resolves.toEqual(before);
  });

  test('凍結の後は、その年の決済期限日より前のWeek優勝の枠を変えず、決済期限日の当日以降の枠だけを喪失にする', async () => {
    await freezeYear2027();
    await insertYearEntries([
      entryOf(1, { ...ENTITLED_BY_ULTRAS, awardedDate: BEFORE_DEADLINE }),
      entryOf(2, { awardedDate: ON_DEADLINE }),
    ]);
    const before = await readEntryRow(1);

    await expect(store.forfeitByOwner(userIdOf(OWNER), AT)).resolves.toEqual([
      yearEntryIdOf(2),
    ]);

    await expect(readEntryRow(1)).resolves.toEqual(before);
    await expect(readEntryRow(2)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'withdrawn',
    });
  });
});
