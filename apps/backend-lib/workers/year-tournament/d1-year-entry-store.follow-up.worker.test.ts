import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { yearTournamentEntries } from '../../../db/schema/tournament/year-tournament-entries.ts';
import type { YearRefundClosedStatus } from '../../core/year-tournament/ports.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  productIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import { D1YearEntryStore } from './d1-year-entry-store.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  type YearEntryFixture,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';

const PURCHASE_ID = '01JD0PVRCHASE0000000000001';

const OLDER_THAN = new Date('2026-11-25T19:11:00.000Z');

const AT = new Date('2026-11-25T19:21:00.000Z');

const store = new D1YearEntryStore(db);

async function readEntryRow(index: number) {
  const [row] = await db
    .select()
    .from(yearTournamentEntries)
    .where(eq(yearTournamentEntries.id, yearEntryIdOf(index)));
  return row;
}

function entryIdsOf(records: readonly { readonly entryId: string }[]) {
  return records.map(({ entryId }) => entryId);
}

const FORFEITED = {
  status: 'forfeited',
  closeReason: 'deleted',
  closedAt: T0,
  entitlementSource: 'payment',
  purchaseId: PURCHASE_ID,
  entitledAt: T0,
} as const;

function followUpEntryOf(
  index: number,
  columns: YearEntryFixture['columns'],
): YearEntryFixture {
  return {
    index,
    launch: index,
    product: index,
    owner: 1,
    columns: { ...FORFEITED, ...columns },
  };
}

// 利用者1のプロダクト1〜9を、同じ番号のローンチ付きで作る
beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(1);
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await insertProduct(index, 1);
    await insertLaunch(index, index);
  }
});

describe('D1YearEntryStore.listPendingFollowUps', () => {
  test('返金待ちまたは知らせ待ちで、更新が基準の時刻より前の枠を、更新の昇順に返す', async () => {
    await insertYearEntries([
      followUpEntryOf(1, {
        refundStatus: 'pending',
        updatedAt: new Date(OLDER_THAN.getTime() - 1),
      }),
      followUpEntryOf(2, {
        refundStatus: 'requested',
        refundNoticeStatus: 'pending',
        updatedAt: new Date('2026-11-25T07:00:00.000Z'),
      }),
      followUpEntryOf(3, {
        refundStatus: 'pending',
        updatedAt: OLDER_THAN,
      }),
      followUpEntryOf(4, {
        refundStatus: 'requested',
        refundNoticeStatus: 'sent',
      }),
      followUpEntryOf(5, {
        refundStatus: 'requested',
        refundNoticeStatus: 'skipped',
      }),
      followUpEntryOf(6, { refundStatus: 'not_needed' }),
      followUpEntryOf(7, { refundStatus: 'already_refunded' }),
      followUpEntryOf(8, { refundStatus: 'rejected' }),
      { index: 9, launch: 9, product: 9, owner: 1 },
    ]);

    const records = await store.listPendingFollowUps(OLDER_THAN, 100);

    expect(entryIdsOf(records)).toEqual([yearEntryIdOf(2), yearEntryIdOf(1)]);
    expect(records[1]).toMatchObject({
      entryId: yearEntryIdOf(1),
      productId: productIdOf(1),
      ownerUserId: userIdOf(1),
      status: 'forfeited',
      purchaseId: PURCHASE_ID,
      closeReason: 'deleted',
      refundStatus: 'pending',
      refundNoticeStatus: 'none',
    });
  });

  test('件数の上限までを返す', async () => {
    await insertYearEntries(
      [1, 2, 3].map((index) =>
        followUpEntryOf(index, {
          refundStatus: 'pending',
          updatedAt: new Date(T0.getTime() + index),
        }),
      ),
    );

    await expect(
      store.listPendingFollowUps(OLDER_THAN, 2).then(entryIdsOf),
    ).resolves.toEqual([yearEntryIdOf(1), yearEntryIdOf(2)]);
  });

  test('紐付けを解除した枠も返す', async () => {
    await insertYearEntries([
      {
        index: 1,
        launch: null,
        product: null,
        owner: null,
        columns: { ...FORFEITED, refundStatus: 'pending' },
      },
    ]);

    await expect(
      store.listPendingFollowUps(OLDER_THAN, 100),
    ).resolves.toMatchObject([
      {
        entryId: yearEntryIdOf(1),
        launchId: null,
        productId: null,
        ownerUserId: null,
      },
    ]);
  });
});

describe('D1YearEntryStore.markRefundRequested', () => {
  test('返金待ちの枠を依頼済みにして依頼の日時を記録し、返金の知らせを知らせ待ちにする', async () => {
    await insertYearEntries([followUpEntryOf(1, { refundStatus: 'pending' })]);

    await store.markRefundRequested(yearEntryIdOf(1), AT);

    await expect(readEntryRow(1)).resolves.toMatchObject({
      refundStatus: 'requested',
      refundRequestedAt: AT,
      refundNoticeStatus: 'pending',
      updatedAt: AT,
    });
    await expect(
      store
        .listPendingFollowUps(new Date(AT.getTime() + 1), 100)
        .then(entryIdsOf),
    ).resolves.toEqual([yearEntryIdOf(1)]);
  });

  test('返金待ちでない枠(依頼済みで知らせを送った枠・返金不要・返金済み・拒否)は変えず、知らせを送り直す状態に戻さない', async () => {
    await insertYearEntries([
      followUpEntryOf(1, {
        refundStatus: 'requested',
        refundRequestedAt: T0,
        refundNoticeStatus: 'sent',
      }),
      followUpEntryOf(2, { refundStatus: 'not_needed' }),
      followUpEntryOf(3, { refundStatus: 'already_refunded' }),
      followUpEntryOf(4, { refundStatus: 'rejected' }),
    ]);
    const before = await Promise.all([1, 2, 3, 4].map(readEntryRow));

    for (const index of [1, 2, 3, 4]) {
      await store.markRefundRequested(yearEntryIdOf(index), AT);
    }

    await expect(Promise.all([1, 2, 3, 4].map(readEntryRow))).resolves.toEqual(
      before,
    );
  });
});

describe('D1YearEntryStore.markRefundClosed', () => {
  test.each<YearRefundClosedStatus>([
    'not_needed',
    'already_refunded',
    'rejected',
  ])(
    '返金待ちの枠を%sにし、返金の知らせを知らせ待ちにせず、返金待ちの一覧から外す',
    async (status) => {
      await insertYearEntries([
        followUpEntryOf(1, { refundStatus: 'pending' }),
      ]);

      await store.markRefundClosed(yearEntryIdOf(1), status, AT);

      await expect(readEntryRow(1)).resolves.toMatchObject({
        refundStatus: status,
        refundRequestedAt: null,
        refundNoticeStatus: 'none',
        updatedAt: AT,
      });
      await expect(
        store.listPendingFollowUps(new Date(AT.getTime() + 1), 100),
      ).resolves.toEqual([]);
    },
  );

  test('返金待ちでない枠(依頼済み・返金済み)は変えない', async () => {
    await insertYearEntries([
      followUpEntryOf(1, {
        refundStatus: 'requested',
        refundRequestedAt: T0,
        refundNoticeStatus: 'pending',
      }),
      followUpEntryOf(2, { refundStatus: 'already_refunded' }),
    ]);
    const before = await Promise.all([1, 2].map(readEntryRow));

    await store.markRefundClosed(yearEntryIdOf(1), 'rejected', AT);
    await store.markRefundClosed(yearEntryIdOf(2), 'not_needed', AT);

    await expect(Promise.all([1, 2].map(readEntryRow))).resolves.toEqual(
      before,
    );
  });
});

describe('D1YearEntryStore.markNotice', () => {
  test.each(['sent', 'skipped'] as const)(
    '知らせ待ちの枠を%sにし、知らせ待ちの一覧から外す',
    async (status) => {
      await insertYearEntries([
        followUpEntryOf(1, {
          refundStatus: 'requested',
          refundRequestedAt: T0,
          refundNoticeStatus: 'pending',
        }),
      ]);

      await store.markNotice(yearEntryIdOf(1), status, AT);

      await expect(readEntryRow(1)).resolves.toMatchObject({
        refundStatus: 'requested',
        refundNoticeStatus: status,
        updatedAt: AT,
      });
      await expect(
        store.listPendingFollowUps(new Date(AT.getTime() + 1), 100),
      ).resolves.toEqual([]);
    },
  );

  test('知らせ待ちでない枠(送信済み・返金待ち)は変えない', async () => {
    await insertYearEntries([
      followUpEntryOf(1, {
        refundStatus: 'requested',
        refundNoticeStatus: 'sent',
      }),
      followUpEntryOf(2, { refundStatus: 'pending' }),
    ]);
    const before = await Promise.all([1, 2].map(readEntryRow));

    await store.markNotice(yearEntryIdOf(1), 'skipped', AT);
    await store.markNotice(yearEntryIdOf(2), 'sent', AT);

    await expect(Promise.all([1, 2].map(readEntryRow))).resolves.toEqual(
      before,
    );
  });
});
