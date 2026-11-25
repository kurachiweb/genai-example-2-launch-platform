import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import type { WeekRefundClosedStatus } from '../../core/week-tournament/ports.ts';
import {
  db,
  insertLaunch,
  insertProduct,
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
  weekEntryIdOf,
  type WeekEntryFixture,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';

const PURCHASE_ID = '01JD0PVRCHASE0000000000001';

const OLDER_THAN = new Date('2026-11-25T12:11:00.000Z');

const AT = new Date('2026-11-25T12:21:00.000Z');

const store = new D1WeekTournamentStore(db);

async function readEntryRow(index: number) {
  const [row] = await db
    .select()
    .from(weekTournamentEntries)
    .where(eq(weekTournamentEntries.id, weekEntryIdOf(index)));
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
  columns: WeekEntryFixture['columns'],
  { tournament = 1, owner = 1 }: { tournament?: number; owner?: number } = {},
): WeekEntryFixture {
  return {
    index,
    tournament,
    launch: index,
    product: index,
    owner,
    columns: { ...FORFEITED, ...columns },
  };
}

// 利用者1のプロダクト1〜8と利用者2のプロダクト9を、同じ番号のローンチ付きで作る
beforeEach(async () => {
  await clearWeekTournamentTables();
  await insertUser(1);
  await insertUser(2);
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await insertProduct(index, index === 9 ? 2 : 1);
    await insertLaunch(index, index);
  }
  await insertWeekTournaments([
    { index: 1 },
    { index: 2, weekStart: '2026-11-09' },
  ]);
});

describe('D1WeekTournamentStore.listPendingFollowUps', () => {
  test('返金待ちまたは知らせ待ちで、更新が基準の時刻より前の枠を、更新の昇順に返す', async () => {
    await insertWeekEntries([
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
      {
        index: 9,
        tournament: 2,
        launch: 9,
        product: 9,
        owner: 2,
      },
    ]);

    const records = await store.listPendingFollowUps(OLDER_THAN, 100);

    expect(entryIdsOf(records)).toEqual([weekEntryIdOf(2), weekEntryIdOf(1)]);
    expect(records[1]).toMatchObject({
      entryId: weekEntryIdOf(1),
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
    await insertWeekEntries(
      [1, 2, 3].map((index) =>
        followUpEntryOf(index, {
          refundStatus: 'pending',
          updatedAt: new Date(T0.getTime() + index),
        }),
      ),
    );

    await expect(
      store.listPendingFollowUps(OLDER_THAN, 2).then(entryIdsOf),
    ).resolves.toEqual([weekEntryIdOf(1), weekEntryIdOf(2)]);
  });
});

describe('D1WeekTournamentStore.listPendingFollowUpsOf', () => {
  // 枠1・2は利用者1・週1、枠3は利用者1・週2、枠9は利用者2・週1。枠4は返金待ちでない
  beforeEach(async () => {
    await insertWeekEntries([
      followUpEntryOf(1, { refundStatus: 'pending', updatedAt: AT }),
      followUpEntryOf(2, {
        refundStatus: 'requested',
        refundNoticeStatus: 'pending',
        updatedAt: AT,
      }),
      followUpEntryOf(3, { refundStatus: 'pending' }, { tournament: 2 }),
      followUpEntryOf(4, { refundStatus: 'not_needed' }),
      followUpEntryOf(9, { refundStatus: 'pending' }, { owner: 2 }),
    ]);
  });

  test('更新の日時によらず、プロダクトの返金待ち・知らせ待ちの枠を返す', async () => {
    await expect(
      store
        .listPendingFollowUpsOf({ productId: productIdOf(1) }, 50)
        .then(entryIdsOf),
    ).resolves.toEqual([weekEntryIdOf(1)]);
    await expect(
      store.listPendingFollowUpsOf({ productId: productIdOf(4) }, 50),
    ).resolves.toEqual([]);
  });

  test('投稿者の返金待ち・知らせ待ちの枠を、週によらず枠のIDの昇順に返す', async () => {
    await expect(
      store
        .listPendingFollowUpsOf({ ownerUserId: userIdOf(1) }, 50)
        .then(entryIdsOf),
    ).resolves.toEqual([weekEntryIdOf(1), weekEntryIdOf(2), weekEntryIdOf(3)]);
  });

  test('週の返金待ち・知らせ待ちの枠を件数の上限まで返す', async () => {
    await expect(
      store
        .listPendingFollowUpsOf({ tournamentId: weekTournamentIdOf(1) }, 50)
        .then(entryIdsOf),
    ).resolves.toEqual([weekEntryIdOf(1), weekEntryIdOf(2), weekEntryIdOf(9)]);
    await expect(
      store
        .listPendingFollowUpsOf({ tournamentId: weekTournamentIdOf(1) }, 2)
        .then(entryIdsOf),
    ).resolves.toEqual([weekEntryIdOf(1), weekEntryIdOf(2)]);
  });
});

describe('D1WeekTournamentStore.markRefundRequested', () => {
  test('返金待ちの枠を依頼済みにして依頼の日時を記録し、返金の知らせを知らせ待ちにする', async () => {
    await insertWeekEntries([followUpEntryOf(1, { refundStatus: 'pending' })]);

    await store.markRefundRequested(weekEntryIdOf(1), AT);

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
    ).resolves.toEqual([weekEntryIdOf(1)]);
  });

  test('返金待ちでない枠(依頼済みで知らせを送った枠・返金不要)は変えず、知らせを送り直す状態に戻さない', async () => {
    await insertWeekEntries([
      followUpEntryOf(1, {
        refundStatus: 'requested',
        refundRequestedAt: T0,
        refundNoticeStatus: 'sent',
      }),
      followUpEntryOf(2, { refundStatus: 'not_needed' }),
    ]);
    const before = await Promise.all([1, 2].map(readEntryRow));

    await store.markRefundRequested(weekEntryIdOf(1), AT);
    await store.markRefundRequested(weekEntryIdOf(2), AT);

    await expect(Promise.all([1, 2].map(readEntryRow))).resolves.toEqual(
      before,
    );
  });
});

describe('D1WeekTournamentStore.markRefundClosed', () => {
  test.each<WeekRefundClosedStatus>([
    'not_needed',
    'already_refunded',
    'rejected',
  ])(
    '返金待ちの枠を%sにし、返金の知らせを送らず、返金待ちの一覧から外す',
    async (status) => {
      await insertWeekEntries([
        followUpEntryOf(1, { refundStatus: 'pending' }),
      ]);

      await store.markRefundClosed(weekEntryIdOf(1), status, AT);

      await expect(readEntryRow(1)).resolves.toMatchObject({
        refundStatus: status,
        refundRequestedAt: null,
        refundNoticeStatus: 'none',
        updatedAt: AT,
      });
      await expect(
        store.listPendingFollowUps(new Date(AT.getTime() + 1), 100),
      ).resolves.toEqual([]);
      await expect(
        store.listPendingFollowUpsOf({ productId: productIdOf(1) }, 50),
      ).resolves.toEqual([]);
    },
  );

  test('返金待ちでない枠(依頼済み)は変えない', async () => {
    await insertWeekEntries([
      followUpEntryOf(1, {
        refundStatus: 'requested',
        refundNoticeStatus: 'pending',
      }),
    ]);
    const before = await readEntryRow(1);

    await store.markRefundClosed(weekEntryIdOf(1), 'rejected', AT);

    await expect(readEntryRow(1)).resolves.toEqual(before);
  });
});

describe('D1WeekTournamentStore.markNotice', () => {
  test.each(['sent', 'skipped'] as const)(
    '知らせ待ちの枠を%sにし、知らせ待ちの一覧から外す',
    async (status) => {
      await insertWeekEntries([
        followUpEntryOf(1, {
          refundStatus: 'requested',
          refundNoticeStatus: 'pending',
        }),
      ]);

      await store.markNotice(weekEntryIdOf(1), status, AT);

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
    await insertWeekEntries([
      followUpEntryOf(1, {
        refundStatus: 'requested',
        refundNoticeStatus: 'sent',
      }),
      followUpEntryOf(2, { refundStatus: 'pending' }),
    ]);
    const before = await Promise.all([1, 2].map(readEntryRow));

    await store.markNotice(weekEntryIdOf(1), 'skipped', AT);
    await store.markNotice(weekEntryIdOf(2), 'sent', AT);

    await expect(Promise.all([1, 2].map(readEntryRow))).resolves.toEqual(
      before,
    );
  });
});
