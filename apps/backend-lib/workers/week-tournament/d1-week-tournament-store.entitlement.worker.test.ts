import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
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
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_WINDOW,
  weekEntryIdOf,
  type WeekEntryFixture,
} from './testing/week-tournament-fixtures.ts';

const AT = new Date('2026-11-22T10:00:00.000Z');

// 枠の勝利の確定(補助の既定値)
const WON_AT = new Date('2026-11-21T08:00:00.000Z');

const PURCHASE_ID = '01JD0PVRCHASE0000000000001';

const FROZEN_AT = WEEK_WINDOW.drawAt;

const OWNER = 1;

const OTHER_OWNER = 2;

const store = new D1WeekTournamentStore(db);

async function readEntryRow(index: number) {
  const [row] = await db
    .select()
    .from(weekTournamentEntries)
    .where(eq(weekTournamentEntries.id, weekEntryIdOf(index)));
  return row;
}

async function readEntryRows(indexes: readonly number[]) {
  return Promise.all(indexes.map(readEntryRow));
}

// 週1(2026-11-16)は受付中、週2(2026-11-23)は凍結済み
async function seedWeeks(): Promise<void> {
  await insertWeekTournaments([
    { index: 1 },
    {
      index: 2,
      weekStart: '2026-11-23',
      columns: {
        status: 'drawing',
        drawStartedAt: FROZEN_AT,
        updatedAt: FROZEN_AT,
      },
    },
  ]);
}

// 利用者1・2のプロダクトを、同じ番号のローンチ付きで作る
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
  columns: WeekEntryFixture['columns'] = {},
  {
    tournament = 1,
    owner = OWNER,
  }: { tournament?: number; owner?: number } = {},
): WeekEntryFixture {
  return {
    index,
    tournament,
    launch: index,
    product: index,
    owner,
    columns,
  };
}

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

beforeEach(async () => {
  await clearWeekTournamentTables();
  await insertUser(OWNER);
  await insertUser(OTHER_OWNER);
  await seedWeeks();
});

describe('D1WeekTournamentStore.grantByUltras', () => {
  beforeEach(async () => {
    await seedProducts([
      { index: 1, owner: OWNER },
      { index: 2, owner: OWNER },
      { index: 3, owner: OTHER_OWNER },
    ]);
  });

  test('加入の有効化が勝利の確定から決済期限までの受付中の枠に、参加資格(Ultras)と資格を得た日時を記録し、枠のIDを返す', async () => {
    await insertWeekEntries([
      entryOf(1),
      entryOf(2, { wonAt: new Date('2026-11-22T08:00:00.000Z') }),
    ]);

    const granted = await store.grantByUltras(userIdOf(OWNER), WON_AT, AT);

    expect(granted).toEqual([weekEntryIdOf(1)]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      status: 'entitled',
      entitlementSource: 'ultras',
      entitledAt: AT,
      closedAt: null,
      closeReason: null,
      refundStatus: 'none',
      updatedAt: AT,
    });
    await expect(readEntryRow(2)).resolves.toMatchObject({
      status: 'awaiting_payment',
      entitlementSource: null,
      entitledAt: null,
      updatedAt: T0,
    });
  });

  test('決済期限ちょうどの有効化は参加資格を与え、決済期限の1ミリ秒後の有効化は与えない', async () => {
    await insertWeekEntries([entryOf(1)]);

    await expect(
      store.grantByUltras(
        userIdOf(OWNER),
        new Date(WEEK_WINDOW.deadlineAt.getTime() + 1),
        AT,
      ),
    ).resolves.toEqual([]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      status: 'awaiting_payment',
    });

    await expect(
      store.grantByUltras(userIdOf(OWNER), WEEK_WINDOW.deadlineAt, AT),
    ).resolves.toEqual([weekEntryIdOf(1)]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      status: 'entitled',
      entitlementSource: 'ultras',
    });
  });

  test('勝利の確定より前の有効化は参加資格を与えない', async () => {
    await insertWeekEntries([entryOf(1)]);

    await expect(
      store.grantByUltras(userIdOf(OWNER), new Date(WON_AT.getTime() - 1), AT),
    ).resolves.toEqual([]);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      status: 'awaiting_payment',
      updatedAt: T0,
    });
  });

  test('他の投稿者の枠と、受付中でない枠(決済・Ultrasで資格を得た枠・組み合わせの対象・期限切れ・喪失・除外)を変えない', async () => {
    await seedProducts([
      { index: 4, owner: OWNER },
      { index: 5, owner: OWNER },
      { index: 6, owner: OWNER },
      { index: 7, owner: OWNER },
      { index: 8, owner: OWNER },
    ]);
    await insertWeekEntries([
      entryOf(3, {}, { owner: OTHER_OWNER }),
      entryOf(4, ENTITLED_BY_PAYMENT),
      entryOf(5, ENTITLED_BY_ULTRAS),
      entryOf(6, { ...ENTITLED_BY_PAYMENT, status: 'drawn', closedAt: T0 }),
      entryOf(7, { status: 'expired', closeReason: 'deadline', closedAt: T0 }),
      entryOf(8, {
        status: 'forfeited',
        closeReason: 'deleted',
        closedAt: T0,
        refundStatus: 'not_needed',
      }),
    ]);
    const before = await readEntryRows([3, 4, 5, 6, 7, 8]);

    await expect(
      store.grantByUltras(userIdOf(OWNER), WON_AT, AT),
    ).resolves.toEqual([]);

    await expect(readEntryRows([3, 4, 5, 6, 7, 8])).resolves.toEqual(before);
  });

  test('凍結済みの週の受付中の枠には、期間内の有効化でも参加資格を与えない', async () => {
    await insertLaunch(9, 1, {
      launchDate: '2026-11-27',
      outcome: 'won',
      decidedAt: new Date('2026-11-28T08:00:00.000Z'),
    });
    await insertWeekEntries([
      {
        ...entryOf(9, {
          launchDate: '2026-11-27',
          wonAt: new Date('2026-11-28T08:00:00.000Z'),
        }),
        tournament: 2,
        product: 1,
      },
    ]);
    const before = await readEntryRow(9);

    await expect(
      store.grantByUltras(
        userIdOf(OWNER),
        new Date('2026-11-29T08:00:00.000Z'),
        AT,
      ),
    ).resolves.toEqual([]);

    await expect(readEntryRow(9)).resolves.toEqual(before);
  });
});

describe('D1WeekTournamentStore.forfeitByProduct', () => {
  // プロダクト1は週1と週2(凍結済み)に、プロダクト2は週1に枠を持つ
  beforeEach(async () => {
    await seedProducts([
      { index: 1, owner: OWNER },
      { index: 2, owner: OWNER },
    ]);
    await insertLaunch(3, 1, {
      launchDate: '2026-11-27',
      outcome: 'won',
      decidedAt: new Date('2026-11-28T08:00:00.000Z'),
    });
  });

  test('凍結前の受付中の枠を、購入が無いため返金不要の喪失(削除)として終了の日時とともに記録し、枠のIDを返す', async () => {
    await insertWeekEntries([entryOf(1), entryOf(2)]);

    await expect(
      store.forfeitByProduct(productIdOf(1), 'deleted', AT),
    ).resolves.toEqual([weekEntryIdOf(1)]);

    await expect(readEntryRow(1)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
      closedAt: AT,
      refundStatus: 'not_needed',
      refundNoticeStatus: 'none',
      updatedAt: AT,
    });
    await expect(readEntryRow(2)).resolves.toMatchObject({
      status: 'awaiting_payment',
      updatedAt: T0,
    });
  });

  test('決済で資格を得た枠は購入を残して返金待ちにし、Ultrasで資格を得た枠は返金不要にする', async () => {
    await insertWeekEntries([
      entryOf(1, ENTITLED_BY_PAYMENT),
      entryOf(2, ENTITLED_BY_ULTRAS),
    ]);

    await expect(
      store.forfeitByProduct(productIdOf(1), 'deleted', AT),
    ).resolves.toEqual([weekEntryIdOf(1)]);
    await expect(
      store.forfeitByProduct(productIdOf(2), 'deleted', AT),
    ).resolves.toEqual([weekEntryIdOf(2)]);

    await expect(readEntryRow(1)).resolves.toMatchObject({
      status: 'forfeited',
      entitlementSource: 'payment',
      purchaseId: PURCHASE_ID,
      entitledAt: T0,
      closeReason: 'deleted',
      closedAt: AT,
      refundStatus: 'pending',
    });
    await expect(readEntryRow(2)).resolves.toMatchObject({
      status: 'forfeited',
      entitlementSource: 'ultras',
      closeReason: 'deleted',
      closedAt: AT,
      refundStatus: 'not_needed',
    });
  });

  test('凍結済みの週の枠と終了した枠を変えず、凍結前の週の枠だけを喪失にする', async () => {
    await insertWeekEntries([
      entryOf(1, ENTITLED_BY_PAYMENT),
      {
        ...entryOf(3, {
          ...ENTITLED_BY_PAYMENT,
          purchaseId: '01JD0PVRCHASE0000000000002',
          launchDate: '2026-11-27',
          wonAt: new Date('2026-11-28T08:00:00.000Z'),
        }),
        tournament: 2,
        product: 1,
      },
    ]);
    const frozen = await readEntryRow(3);

    await expect(
      store.forfeitByProduct(productIdOf(1), 'deleted', AT),
    ).resolves.toEqual([weekEntryIdOf(1)]);
    await expect(
      store.forfeitByProduct(productIdOf(1), 'deleted', AT),
    ).resolves.toEqual([]);

    await expect(readEntryRow(3)).resolves.toEqual(frozen);
    await expect(readEntryRow(1)).resolves.toMatchObject({
      status: 'forfeited',
      refundStatus: 'pending',
      updatedAt: AT,
    });
  });

  test('組み合わせの対象・期限切れ・除外の枠を変えない', async () => {
    await seedProducts([
      { index: 4, owner: OWNER },
      { index: 5, owner: OWNER },
    ]);
    await insertWeekEntries([
      entryOf(1, { ...ENTITLED_BY_PAYMENT, status: 'drawn', closedAt: T0 }),
      entryOf(4, { status: 'expired', closeReason: 'deadline', closedAt: T0 }),
      entryOf(5, {
        ...ENTITLED_BY_PAYMENT,
        status: 'excluded',
        closeReason: 'hidden_or_suspended',
        closedAt: T0,
        refundStatus: 'requested',
      }),
    ]);
    const before = await readEntryRows([1, 4, 5]);

    for (const index of [1, 4, 5]) {
      await expect(
        store.forfeitByProduct(productIdOf(index), 'deleted', AT),
      ).resolves.toEqual([]);
    }

    await expect(readEntryRows([1, 4, 5])).resolves.toEqual(before);
  });
});

describe('D1WeekTournamentStore.forfeitByOwner', () => {
  beforeEach(async () => {
    await seedProducts([
      { index: 1, owner: OWNER },
      { index: 2, owner: OWNER },
      { index: 3, owner: OWNER },
      { index: 4, owner: OWNER },
      { index: 5, owner: OTHER_OWNER },
    ]);
    await insertLaunch(6, 4, {
      launchDate: '2026-11-27',
      outcome: 'won',
      decidedAt: new Date('2026-11-28T08:00:00.000Z'),
    });
  });

  test('投稿者の凍結前の受付中・資格を得た枠をすべて喪失(退会)にし、購入の有無で返金待ちと返金不要を分け、枠のIDを返す', async () => {
    await insertWeekEntries([
      entryOf(1),
      entryOf(2, ENTITLED_BY_PAYMENT),
      entryOf(3, ENTITLED_BY_ULTRAS),
      entryOf(4, { status: 'expired', closeReason: 'deadline', closedAt: T0 }),
      {
        ...entryOf(6, {
          ...ENTITLED_BY_PAYMENT,
          purchaseId: '01JD0PVRCHASE0000000000002',
          launchDate: '2026-11-27',
          wonAt: new Date('2026-11-28T08:00:00.000Z'),
        }),
        tournament: 2,
        product: 4,
      },
      entryOf(5, ENTITLED_BY_PAYMENT, { owner: OTHER_OWNER }),
    ]);
    const untouched = await readEntryRows([4, 6, 5]);

    const forfeited = await store.forfeitByOwner(
      userIdOf(OWNER),
      'withdrawn',
      AT,
    );

    expect(forfeited.toSorted()).toEqual(
      [1, 2, 3].map(weekEntryIdOf).toSorted(),
    );
    await expect(readEntryRows([1, 2, 3])).resolves.toEqual([
      expect.objectContaining({
        status: 'forfeited',
        entitlementSource: null,
        closeReason: 'withdrawn',
        closedAt: AT,
        refundStatus: 'not_needed',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'forfeited',
        entitlementSource: 'payment',
        closeReason: 'withdrawn',
        closedAt: AT,
        refundStatus: 'pending',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'forfeited',
        entitlementSource: 'ultras',
        closeReason: 'withdrawn',
        closedAt: AT,
        refundStatus: 'not_needed',
        updatedAt: AT,
      }),
    ]);
    await expect(readEntryRows([4, 6, 5])).resolves.toEqual(untouched);
  });

  test('凍結済みの週の枠しか無ければ何も変えず、空の一覧を返す', async () => {
    await insertWeekEntries([
      {
        ...entryOf(6, {
          launchDate: '2026-11-27',
          wonAt: new Date('2026-11-28T08:00:00.000Z'),
        }),
        tournament: 2,
        product: 4,
      },
    ]);
    const before = await readEntryRow(6);

    await expect(
      store.forfeitByOwner(userIdOf(OWNER), 'withdrawn', AT),
    ).resolves.toEqual([]);

    await expect(readEntryRow(6)).resolves.toEqual(before);
  });
});

describe('D1WeekTournamentStore.classify', () => {
  // 凍結済みの週2の枠を分類する
  function frozenEntryOf(
    index: number,
    columns: WeekEntryFixture['columns'] = {},
  ): WeekEntryFixture {
    return entryOf(index, columns, { tournament: 2 });
  }

  test('凍結済みの週の受付中・資格を得た枠に、状態・理由・終了の日時と、除外・喪失の購入の有無による返金待ち・返金不要を記録する', async () => {
    await seedProducts(
      [1, 2, 3, 4, 5, 6, 7].map((index) => ({ index, owner: OWNER })),
    );
    await insertWeekEntries([
      frozenEntryOf(1, ENTITLED_BY_PAYMENT),
      frozenEntryOf(2, {
        ...ENTITLED_BY_PAYMENT,
        purchaseId: '01JD0PVRCHASE0000000000002',
      }),
      frozenEntryOf(3, ENTITLED_BY_ULTRAS),
      frozenEntryOf(4),
      frozenEntryOf(5),
      frozenEntryOf(6),
      frozenEntryOf(7),
    ]);

    await store.classify(
      [
        { entryId: weekEntryIdOf(1), status: 'drawn', closeReason: null },
        {
          entryId: weekEntryIdOf(2),
          status: 'excluded',
          closeReason: 'hidden_or_suspended',
        },
        {
          entryId: weekEntryIdOf(3),
          status: 'excluded',
          closeReason: 'hidden_or_suspended',
        },
        {
          entryId: weekEntryIdOf(4),
          status: 'forfeited',
          closeReason: 'deleted',
        },
        {
          entryId: weekEntryIdOf(5),
          status: 'expired',
          closeReason: 'deadline',
        },
        {
          entryId: weekEntryIdOf(6),
          status: 'entitled',
          closeReason: null,
          entitlementSource: 'ultras',
        },
        {
          entryId: weekEntryIdOf(7),
          status: 'drawn',
          closeReason: null,
          entitlementSource: 'ultras',
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
        refundStatus: 'none',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'excluded',
        entitlementSource: 'payment',
        closeReason: 'hidden_or_suspended',
        closedAt: AT,
        refundStatus: 'pending',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'excluded',
        entitlementSource: 'ultras',
        closeReason: 'hidden_or_suspended',
        closedAt: AT,
        refundStatus: 'not_needed',
      }),
      expect.objectContaining({
        status: 'forfeited',
        entitlementSource: null,
        closeReason: 'deleted',
        closedAt: AT,
        refundStatus: 'not_needed',
      }),
      expect.objectContaining({
        status: 'expired',
        entitlementSource: null,
        entitledAt: null,
        closeReason: 'deadline',
        closedAt: AT,
        refundStatus: 'none',
      }),
      expect.objectContaining({
        status: 'entitled',
        entitlementSource: 'ultras',
        entitledAt: AT,
        closeReason: null,
        closedAt: null,
        refundStatus: 'none',
        updatedAt: AT,
      }),
      expect.objectContaining({
        status: 'drawn',
        entitlementSource: 'ultras',
        entitledAt: AT,
        closeReason: null,
        closedAt: AT,
        refundStatus: 'none',
      }),
    ]);
  });

  test('決済で資格を得た枠の出どころと資格を得た日時は、Ultrasの指定があっても変えない', async () => {
    await seedProducts([{ index: 1, owner: OWNER }]);
    await insertWeekEntries([frozenEntryOf(1, ENTITLED_BY_PAYMENT)]);

    await store.classify(
      [
        {
          entryId: weekEntryIdOf(1),
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

  test('分類済み・凍結前に喪失した枠(受付中・資格を得た枠でないもの)は条件の不一致で変えない', async () => {
    await seedProducts([1, 2, 3, 4].map((index) => ({ index, owner: OWNER })));
    await insertWeekEntries([
      frozenEntryOf(1, {
        ...ENTITLED_BY_PAYMENT,
        status: 'drawn',
        closedAt: T0,
      }),
      frozenEntryOf(2, {
        ...ENTITLED_BY_PAYMENT,
        status: 'forfeited',
        closeReason: 'withdrawn',
        closedAt: T0,
        refundStatus: 'requested',
        refundNoticeStatus: 'sent',
      }),
      frozenEntryOf(3, {
        status: 'expired',
        closeReason: 'deadline',
        closedAt: T0,
      }),
      frozenEntryOf(4, {
        ...ENTITLED_BY_ULTRAS,
        status: 'excluded',
        closeReason: 'hidden_or_suspended',
        closedAt: T0,
        refundStatus: 'not_needed',
      }),
    ]);
    const before = await readEntryRows([1, 2, 3, 4]);

    await store.classify(
      [
        {
          entryId: weekEntryIdOf(1),
          status: 'excluded',
          closeReason: 'hidden_or_suspended',
        },
        { entryId: weekEntryIdOf(2), status: 'drawn', closeReason: null },
        {
          entryId: weekEntryIdOf(3),
          status: 'entitled',
          closeReason: null,
          entitlementSource: 'ultras',
        },
        { entryId: weekEntryIdOf(4), status: 'drawn', closeReason: null },
      ],
      AT,
    );

    await expect(readEntryRows([1, 2, 3, 4])).resolves.toEqual(before);
  });

  test('50件を超える分類は50件ずつの一括の書き込みに分け、すべての枠に記録する', async () => {
    const indexes = Array.from({ length: 60 }, (_, offset) => offset + 100);
    await insertProducts(indexes, OWNER);
    await insertLaunches(
      indexes.map((index) => ({ index, productIndex: index })),
    );
    await insertWeekEntries(
      indexes.map((index) => frozenEntryOf(index, ENTITLED_BY_ULTRAS)),
    );
    const recording = batchRecordingDatabase();

    await new D1WeekTournamentStore(recording.database).classify(
      indexes.map((index) => ({
        entryId: weekEntryIdOf(index),
        status: 'drawn',
        closeReason: null,
      })),
      AT,
    );

    expect(recording.batchSizes).toEqual([50, 10]);
    const rows = await readEntryRows(indexes);
    expect(rows.every((row) => row?.status === 'drawn')).toBe(true);
  });

  test('空の分類では書き込まない', async () => {
    const recording = batchRecordingDatabase();

    await new D1WeekTournamentStore(recording.database).classify([], AT);

    expect(recording.batchSizes).toEqual([]);
  });
});

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
