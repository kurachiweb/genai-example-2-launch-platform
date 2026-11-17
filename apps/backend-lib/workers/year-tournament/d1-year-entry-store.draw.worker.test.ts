import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import type { YearEntryRecord } from '../../core/year-tournament/ports.ts';
import { refundReasonFor } from '../../core/year-tournament/year-entry-rules.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import {
  db,
  insertLaunches,
  insertProducts,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1YearEntryStore } from './d1-year-entry-store.ts';
import {
  championWeekTournamentIdOf,
  clearYearTournamentTables,
  insertYearEntries,
  type YearEntryFixture,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';

const AT = new Date('2027-05-24T14:45:00.000Z');

const LATER = new Date('2027-05-24T14:50:00.000Z');

const PURCHASE_ID = '01JD0PVRCHASE0000000000001';

const IDS_OVER_ONE_STATEMENT = 95;

const OWNER = 1;

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

const DRAWN_BY_PAYMENT = {
  ...ENTITLED_BY_PAYMENT,
  status: 'drawn',
  classifiedYear: 2027,
  closedAt: T0,
} as const;

const DRAWN_BY_ULTRAS = {
  ...ENTITLED_BY_ULTRAS,
  status: 'drawn',
  classifiedYear: 2027,
  closedAt: T0,
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

// 記録した状態と理由の組み合わせから返金の理由を求める(喪失・除外でないか理由が無ければundefined)
function refundReasonOfRow(
  row: Awaited<ReturnType<typeof readEntryRow>>,
): ReturnType<typeof refundReasonFor> | undefined {
  if (
    row === undefined ||
    row.closeReason === null ||
    (row.status !== 'forfeited' && row.status !== 'excluded')
  ) {
    return undefined;
  }
  return refundReasonFor(row.status, row.closeReason);
}

function entryOf(
  index: number,
  columns: YearEntryFixture['columns'] = {},
): YearEntryFixture {
  return { index, launch: index, product: index, owner: OWNER, columns };
}

// 利用者1のプロダクトを、同じ番号のローンチ付きで作る
async function seedProducts(indexes: readonly number[]): Promise<void> {
  await insertProducts(indexes, OWNER);
  await insertLaunches(
    indexes.map((index) => ({ index, productIndex: index })),
  );
}

// 一括の書き込みの文の数を記録する
function batchRecordingDatabase(): {
  readonly database: Database;
  readonly batchSizes: readonly number[];
} {
  const batchSizes: number[] = [];
  const database = new Proxy(db, {
    get(target, property, receiver) {
      if (property === 'batch') {
        return async (items: Parameters<Database['batch']>[0]) => {
          batchSizes.push(items.length);
          return target.batch(items);
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { database, batchSizes };
}

beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(OWNER);
});

describe('D1YearEntryStore.classify', () => {
  test('受付中・参加資格の枠に、状態・理由・終了の日時・終えた年と、喪失・除外の購入の有無による返金待ち・返金不要を記録する', async () => {
    await seedProducts([1, 2, 3, 4, 5, 6, 7]);
    await insertYearEntries([
      entryOf(1, ENTITLED_BY_PAYMENT),
      entryOf(2),
      entryOf(3),
      entryOf(4, ENTITLED_BY_PAYMENT),
      entryOf(5),
      entryOf(6, ENTITLED_BY_PAYMENT),
      entryOf(7, ENTITLED_BY_ULTRAS),
    ]);

    await store.classify(
      2027,
      [
        { entryId: yearEntryIdOf(1), status: 'drawn', closeReason: null },
        {
          entryId: yearEntryIdOf(2),
          status: 'drawn',
          closeReason: null,
          entitlementSource: 'ultras',
        },
        {
          entryId: yearEntryIdOf(3),
          status: 'expired',
          closeReason: 'deadline',
        },
        {
          entryId: yearEntryIdOf(4),
          status: 'forfeited',
          closeReason: 'deleted',
        },
        {
          entryId: yearEntryIdOf(5),
          status: 'forfeited',
          closeReason: 'deleted',
        },
        {
          entryId: yearEntryIdOf(6),
          status: 'excluded',
          closeReason: 'hidden_or_suspended',
        },
        {
          entryId: yearEntryIdOf(7),
          status: 'excluded',
          closeReason: 'hidden_or_suspended',
        },
      ],
      AT,
    );

    await expect(readEntryRows([1, 2, 3, 4, 5, 6, 7])).resolves.toEqual([
      expect.objectContaining({
        status: 'drawn',
        entitlementSource: 'payment',
        purchaseId: PURCHASE_ID,
        entitledAt: T0,
        closeReason: null,
        closedAt: AT,
        classifiedYear: 2027,
        refundStatus: 'none',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'drawn',
        entitlementSource: 'ultras',
        entitledAt: AT,
        closeReason: null,
        closedAt: AT,
        classifiedYear: 2027,
        refundStatus: 'none',
      }),
      expect.objectContaining({
        status: 'expired',
        entitlementSource: null,
        entitledAt: null,
        closeReason: 'deadline',
        closedAt: AT,
        classifiedYear: 2027,
        refundStatus: 'none',
      }),
      expect.objectContaining({
        status: 'forfeited',
        entitlementSource: 'payment',
        closeReason: 'deleted',
        closedAt: AT,
        classifiedYear: 2027,
        refundStatus: 'pending',
      }),
      expect.objectContaining({
        status: 'forfeited',
        closeReason: 'deleted',
        classifiedYear: 2027,
        refundStatus: 'not_needed',
      }),
      expect.objectContaining({
        status: 'excluded',
        entitlementSource: 'payment',
        closeReason: 'hidden_or_suspended',
        closedAt: AT,
        classifiedYear: 2027,
        refundStatus: 'pending',
      }),
      expect.objectContaining({
        status: 'excluded',
        entitlementSource: 'ultras',
        closeReason: 'hidden_or_suspended',
        classifiedYear: 2027,
        refundStatus: 'not_needed',
      }),
    ]);
  });

  test('喪失は削除、除外は非公開化・停止の理由で記録し、返金の理由がそれぞれ喪失・停止になる', async () => {
    await seedProducts([1, 2]);
    await insertYearEntries([
      entryOf(1, ENTITLED_BY_PAYMENT),
      entryOf(2, ENTITLED_BY_PAYMENT),
    ]);

    await store.classify(
      2027,
      [
        {
          entryId: yearEntryIdOf(1),
          status: 'forfeited',
          closeReason: 'deleted',
        },
        {
          entryId: yearEntryIdOf(2),
          status: 'excluded',
          closeReason: 'hidden_or_suspended',
        },
      ],
      AT,
    );

    const rows = await readEntryRows([1, 2]);
    expect(rows.map(refundReasonOfRow)).toEqual([
      'entitlement_lost',
      'entitlement_suspended',
    ]);
  });

  test('決済で得た参加資格の出どころと資格を得た日時は、Ultrasの指定があっても変えない', async () => {
    await seedProducts([1]);
    await insertYearEntries([entryOf(1, ENTITLED_BY_PAYMENT)]);

    await store.classify(
      2027,
      [
        {
          entryId: yearEntryIdOf(1),
          status: 'drawn',
          closeReason: null,
          entitlementSource: 'ultras',
        },
      ],
      AT,
    );

    await expect(readEntryRow(1)).resolves.toMatchObject({
      status: 'drawn',
      entitlementSource: 'payment',
      purchaseId: PURCHASE_ID,
      entitledAt: T0,
    });
  });

  test('分類済み・凍結前に喪失した枠(受付中・参加資格の枠でないもの)は条件の不一致で変えない', async () => {
    await seedProducts([1, 2, 3, 4]);
    await insertYearEntries([
      entryOf(1, { ...DRAWN_BY_PAYMENT, classifiedYear: 2026 }),
      entryOf(2, {
        ...ENTITLED_BY_PAYMENT,
        status: 'forfeited',
        closeReason: 'withdrawn',
        closedAt: T0,
        refundStatus: 'requested',
        refundNoticeStatus: 'sent',
      }),
      entryOf(3, {
        status: 'expired',
        closeReason: 'late_entry',
        classifiedYear: 2027,
        closedAt: T0,
        refundStatus: 'not_needed',
      }),
      entryOf(4, {
        ...DRAWN_BY_ULTRAS,
        status: 'excluded',
        closeReason: 'hidden_or_suspended',
        refundStatus: 'not_needed',
      }),
    ]);
    const before = await readEntryRows([1, 2, 3, 4]);

    await store.classify(
      2027,
      [
        {
          entryId: yearEntryIdOf(1),
          status: 'excluded',
          closeReason: 'hidden_or_suspended',
        },
        { entryId: yearEntryIdOf(2), status: 'drawn', closeReason: null },
        {
          entryId: yearEntryIdOf(3),
          status: 'drawn',
          closeReason: null,
          entitlementSource: 'ultras',
        },
        { entryId: yearEntryIdOf(4), status: 'drawn', closeReason: null },
      ],
      AT,
    );

    await expect(readEntryRows([1, 2, 3, 4])).resolves.toEqual(before);
  });

  test('50件を超える分類は50件ずつの一括の書き込みに分け、すべての枠に記録する', async () => {
    const indexes = Array.from({ length: 60 }, (_, offset) => offset + 100);
    await seedProducts(indexes);
    await insertYearEntries(
      indexes.map((index) => entryOf(index, ENTITLED_BY_ULTRAS)),
    );
    const recording = batchRecordingDatabase();

    await new D1YearEntryStore(recording.database).classify(
      2027,
      indexes.map((index) => ({
        entryId: yearEntryIdOf(index),
        status: 'drawn',
        closeReason: null,
      })),
      AT,
    );

    expect(recording.batchSizes).toEqual([50, 10]);
    const rows = await readEntryRows(indexes);
    expect(
      rows.every(
        (row) => row?.status === 'drawn' && row.classifiedYear === 2027,
      ),
    ).toBe(true);
  });

  test('空の分類では書き込まない', async () => {
    const recording = batchRecordingDatabase();

    await new D1YearEntryStore(recording.database).classify(2027, [], AT);

    expect(recording.batchSizes).toEqual([]);
  });
});

describe('D1YearEntryStore.excludeOverCapacity', () => {
  test('その年の組み合わせの対象の枠を上限による除外にし、購入があれば返金待ち、無ければ返金不要を記録する', async () => {
    await seedProducts([1, 2, 3]);
    await insertYearEntries([
      entryOf(1, DRAWN_BY_PAYMENT),
      entryOf(2, DRAWN_BY_ULTRAS),
      entryOf(3, DRAWN_BY_ULTRAS),
    ]);

    await store.excludeOverCapacity(
      2027,
      [yearEntryIdOf(1), yearEntryIdOf(2)],
      AT,
    );

    await expect(readEntryRows([1, 2, 3])).resolves.toEqual([
      expect.objectContaining({
        status: 'excluded',
        closeReason: 'over_capacity',
        entitlementSource: 'payment',
        purchaseId: PURCHASE_ID,
        entitledAt: T0,
        classifiedYear: 2027,
        closedAt: AT,
        refundStatus: 'pending',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'excluded',
        closeReason: 'over_capacity',
        entitlementSource: 'ultras',
        classifiedYear: 2027,
        closedAt: AT,
        refundStatus: 'not_needed',
      }),
      expect.objectContaining({
        status: 'drawn',
        closeReason: null,
        closedAt: T0,
        refundStatus: 'none',
        updatedAt: T0,
      }),
    ]);
    await expect(readEntryRow(1).then(refundReasonOfRow)).resolves.toBe(
      'capacity_exceeded',
    );
  });

  test('組み合わせの対象でない枠と別の年の枠は条件の不一致で変えず、再実行しても除外を書き換えない', async () => {
    await seedProducts([1, 2, 3, 4]);
    await insertYearEntries([
      entryOf(1, DRAWN_BY_PAYMENT),
      entryOf(2, { ...DRAWN_BY_ULTRAS, classifiedYear: 2028 }),
      entryOf(3, ENTITLED_BY_PAYMENT),
      entryOf(4, {
        ...DRAWN_BY_ULTRAS,
        status: 'excluded',
        closeReason: 'hidden_or_suspended',
        refundStatus: 'not_needed',
      }),
    ]);
    const ids = [1, 2, 3, 4].map(yearEntryIdOf);
    await store.excludeOverCapacity(2027, ids, AT);
    const before = await readEntryRows([1, 2, 3, 4]);

    await store.excludeOverCapacity(2027, ids, LATER);

    await expect(readEntryRows([1, 2, 3, 4])).resolves.toEqual(before);
    expect(before.map((row) => row?.status)).toEqual([
      'excluded',
      'drawn',
      'entitled',
      'excluded',
    ]);
    expect(before[3]).toMatchObject({
      closeReason: 'hidden_or_suspended',
      updatedAt: T0,
    });
  });

  test('空の入力では問い合わせない', async () => {
    const recording = createRecordingDatabase();

    await new D1YearEntryStore(recording.database).excludeOverCapacity(
      2027,
      [],
      AT,
    );

    expect(recording.placeholderCounts).toEqual([]);
  });

  test('90件を超える枠はバインド変数の上限に収まるよう分けて更新し、すべての枠を除外する', async () => {
    const indexes = Array.from(
      { length: IDS_OVER_ONE_STATEMENT },
      (_, offset) => offset + 100,
    );
    await seedProducts(indexes);
    await insertYearEntries(
      indexes.map((index) => entryOf(index, DRAWN_BY_ULTRAS)),
    );
    const recording = createRecordingDatabase();

    await new D1YearEntryStore(recording.database).excludeOverCapacity(
      2027,
      indexes.map(yearEntryIdOf),
      AT,
    );

    const rows = await readEntryRows(indexes);
    expect(rows.every((row) => row?.closeReason === 'over_capacity')).toBe(
      true,
    );
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});

describe('D1YearEntryStore.listDrawn', () => {
  // insertYearEntriesの既定の列から求めた組み合わせ済みの記録
  function drawnRecordOf(
    index: number,
    overrides: Partial<YearEntryRecord> = {},
  ): YearEntryRecord {
    return {
      entryId: yearEntryIdOf(index),
      weekTournamentId: championWeekTournamentIdOf(index),
      weekPeriod: '2026-W47',
      launchId: launchIdOf(index),
      productId: productIdOf(index),
      ownerUserId: userIdOf(OWNER),
      launchDate: parseBusinessDate('2026-11-20'),
      qualifierUpvoteCount: 10,
      qualifierLastUpvoteElapsedMs: 3_600_000,
      awardedAt: new Date('2026-11-24T07:45:00.000Z'),
      awardedDate: parseBusinessDate('2026-11-23'),
      status: 'drawn',
      entitlementSource: 'ultras',
      purchaseId: null,
      closeReason: null,
      classifiedYear: 2027,
      refundStatus: 'none',
      refundNoticeStatus: 'none',
      ...overrides,
    };
  }

  test('その年の組み合わせの対象の枠を、紐付けを解除した枠も含めて枠のIDの昇順で返す', async () => {
    await seedProducts([1, 2, 3, 4, 5]);
    await insertYearEntries([
      entryOf(3, DRAWN_BY_PAYMENT),
      entryOf(1, DRAWN_BY_ULTRAS),
      {
        index: 6,
        launch: null,
        product: null,
        owner: null,
        columns: DRAWN_BY_ULTRAS,
      },
      entryOf(2, { ...DRAWN_BY_ULTRAS, classifiedYear: 2028 }),
      entryOf(4, {
        ...DRAWN_BY_ULTRAS,
        status: 'excluded',
        closeReason: 'over_capacity',
        refundStatus: 'not_needed',
      }),
      entryOf(5, ENTITLED_BY_ULTRAS),
    ]);

    await expect(store.listDrawn(2027)).resolves.toEqual([
      drawnRecordOf(1),
      drawnRecordOf(3, {
        entitlementSource: 'payment',
        purchaseId: PURCHASE_ID,
      }),
      drawnRecordOf(6, { launchId: null, productId: null, ownerUserId: null }),
    ]);
  });

  test('組み合わせの対象の枠が無い年は空の一覧を返す', async () => {
    await expect(store.listDrawn(2027)).resolves.toEqual([]);
  });
});
