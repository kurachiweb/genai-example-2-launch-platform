import { beforeEach, describe, expect, test } from 'vitest';

import {
  insertUser,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  ENTITLED_BY_PAYMENT,
  ENTITLED_BY_ULTRAS,
  PLAIN_OWNER,
  PURCHASE_ID,
  seedProducts,
  SUSPENDED_OWNER,
  ULTRAS_OWNER,
} from '../week-tournament/testing/draw-service-fixtures.ts';
import {
  createDrawService,
  DEADLINE_AT,
  DRAW_AT,
  entryOf,
  readEntry,
} from './testing/year-draw-fixtures.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  insertYearTournaments,
  YEAR,
} from './testing/year-tournament-fixtures.ts';

// 枠の既定のWeek優勝の日時(2026-11-23の23:45)
const AWARDED_AT = new Date('2026-11-24T07:45:00.000Z');

// 決済期限日(2027-05-24)の12:00に確定したWeek優勝。翌年の対象になる
const AWARDED_ON_DEADLINE_DATE = {
  awardedAt: new Date('2027-05-24T20:00:00.000Z'),
  awardedDate: '2027-05-24',
};

// 開催しなかった2026年の決済期限日(既定の5/25)より前のWeek優勝
const AWARDED_BEFORE_UNHELD_YEAR = {
  awardedAt: new Date('2026-03-10T20:00:00.000Z'),
  awardedDate: '2026-03-10',
};

// 1・2: 可視の決済・Ultrasの参加資格、3: 非公開化の決済の参加資格、4: 停止中の投稿者の決済の参加資格、
// 5・6: 論理削除済みの決済・Ultrasの参加資格、7・8: Ultrasの期間内の受付中(可視・非公開化)、
// 9・10: 特典の無い受付中(可視・論理削除済み)、11: 遅れたWeek優勝の期限切れ、12: 決済期限日に確定したWeek優勝の受付中、
// 13・14: 開催しなかった前年の対象期間のWeek優勝(決済の参加資格・Ultrasの期間内の受付中)
beforeEach(async () => {
  await clearYearTournamentTables();
  await insertUser(PLAIN_OWNER);
  await insertUser(ULTRAS_OWNER);
  await insertUser(SUSPENDED_OWNER, { status: 'suspended', suspendedAt: T0 });
  await insertYearTournaments([{ index: 1 }]);
  await seedProducts(PLAIN_OWNER, [1, 2, 9, 11, 13]);
  await seedProducts(PLAIN_OWNER, [3], { hiddenAt: T0 });
  await seedProducts(PLAIN_OWNER, [5, 6, 10], { deletedAt: T0 });
  await seedProducts(SUSPENDED_OWNER, [4]);
  await seedProducts(ULTRAS_OWNER, [7, 12, 14]);
  await seedProducts(ULTRAS_OWNER, [8], { hiddenAt: T0 });
  await insertYearEntries([
    entryOf(1, PLAIN_OWNER, ENTITLED_BY_PAYMENT),
    entryOf(2, PLAIN_OWNER, ENTITLED_BY_ULTRAS),
    entryOf(3, PLAIN_OWNER, ENTITLED_BY_PAYMENT),
    entryOf(4, SUSPENDED_OWNER, ENTITLED_BY_PAYMENT),
    entryOf(5, PLAIN_OWNER, ENTITLED_BY_PAYMENT),
    entryOf(6, PLAIN_OWNER, ENTITLED_BY_ULTRAS),
    entryOf(7, ULTRAS_OWNER),
    entryOf(8, ULTRAS_OWNER),
    entryOf(9, PLAIN_OWNER),
    entryOf(10, PLAIN_OWNER),
    entryOf(11, PLAIN_OWNER, {
      status: 'expired',
      closeReason: 'late_entry',
      closedAt: T0,
      classifiedYear: YEAR,
      refundStatus: 'not_needed',
    }),
    entryOf(12, ULTRAS_OWNER, AWARDED_ON_DEADLINE_DATE),
    entryOf(13, PLAIN_OWNER, {
      ...ENTITLED_BY_PAYMENT,
      ...AWARDED_BEFORE_UNHELD_YEAR,
    }),
    entryOf(14, ULTRAS_OWNER, AWARDED_BEFORE_UNHELD_YEAR),
  ]);
});

describe('YearTournamentDrawService.drawDue(分類)', () => {
  test('参加資格の枠は、可視なら組み合わせの対象、非公開化・停止なら除外、論理削除済みなら喪失とし、決済した枠だけを返金待ちにする', async () => {
    const { service } = createDrawService();

    await service.drawDue(DRAW_AT);

    await expect(readEntry(1)).resolves.toEqual({
      status: 'drawn',
      closeReason: null,
      entitlementSource: 'payment',
      purchaseId: PURCHASE_ID,
      entitledAt: T0,
      closedAt: DRAW_AT,
      classifiedYear: YEAR,
      refundStatus: 'none',
    });
    await expect(readEntry(2)).resolves.toMatchObject({
      status: 'drawn',
      entitlementSource: 'ultras',
      entitledAt: T0,
      classifiedYear: YEAR,
      refundStatus: 'none',
    });
    for (const index of [3, 4]) {
      await expect(readEntry(index)).resolves.toEqual({
        status: 'excluded',
        closeReason: 'hidden_or_suspended',
        entitlementSource: 'payment',
        purchaseId: PURCHASE_ID,
        entitledAt: T0,
        closedAt: DRAW_AT,
        classifiedYear: YEAR,
        refundStatus: 'pending',
      });
    }
    await expect(readEntry(5)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
      closedAt: DRAW_AT,
      classifiedYear: YEAR,
      refundStatus: 'pending',
    });
    await expect(readEntry(6)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
      classifiedYear: YEAR,
      refundStatus: 'not_needed',
    });
  });

  test('受付中の枠はWeek優勝の確定から決済期限までにUltrasの期間があれば参加資格(Ultras)として同じ規則で分類し、それ以外は期限切れにする', async () => {
    const { service } = createDrawService();

    await service.drawDue(DRAW_AT);

    await expect(readEntry(7)).resolves.toEqual({
      status: 'drawn',
      closeReason: null,
      entitlementSource: 'ultras',
      purchaseId: null,
      entitledAt: DRAW_AT,
      closedAt: DRAW_AT,
      classifiedYear: YEAR,
      refundStatus: 'none',
    });
    await expect(readEntry(8)).resolves.toMatchObject({
      status: 'excluded',
      closeReason: 'hidden_or_suspended',
      entitlementSource: 'ultras',
      refundStatus: 'not_needed',
    });
    for (const index of [9, 10]) {
      await expect(readEntry(index)).resolves.toEqual({
        status: 'expired',
        closeReason: 'deadline',
        entitlementSource: null,
        purchaseId: null,
        entitledAt: null,
        closedAt: DRAW_AT,
        classifiedYear: YEAR,
        refundStatus: 'none',
      });
    }
  });

  test('Ultrasの判定は投稿者の候補を絞ってから、枠ごとにWeek優勝の日時から決済期限までを問い合わせる', async () => {
    const { service, queries } = createDrawService();

    await service.drawDue(DRAW_AT);

    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query.to).toEqual(DEADLINE_AT);
    }
    expect(
      queries
        .filter(({ userIds }) => userIds.length === 1)
        .map(({ userIds, from }) => ({ userId: userIds[0], from })),
    ).toEqual([
      { userId: userIdOf(ULTRAS_OWNER), from: AWARDED_AT },
      { userId: userIdOf(ULTRAS_OWNER), from: AWARDED_AT },
      {
        userId: userIdOf(ULTRAS_OWNER),
        from: AWARDED_BEFORE_UNHELD_YEAR.awardedAt,
      },
    ]);
    expect(
      queries
        .filter(({ userIds }) => userIds.length > 1)
        .map(({ userIds, from }) => ({ userIds: userIds.toSorted(), from })),
    ).toEqual([
      {
        userIds: [userIdOf(PLAIN_OWNER), userIdOf(ULTRAS_OWNER)],
        from: AWARDED_BEFORE_UNHELD_YEAR.awardedAt,
      },
    ]);
  });

  test('終えた枠と、決済期限日以後に確定したWeek優勝の枠は変えない', async () => {
    const { service, entries } = createDrawService();

    await service.drawDue(DRAW_AT);

    await expect(readEntry(11)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'late_entry',
      closedAt: T0,
    });
    await expect(readEntry(12)).resolves.toMatchObject({
      status: 'awaiting_payment',
      closedAt: null,
      classifiedYear: null,
    });
    expect(entries.classified).toHaveLength(12);
  });

  test('初年度は起点を設けず、開催しなかった前年の対象期間のWeek優勝の枠も対象に含める', async () => {
    const { service } = createDrawService();

    await service.drawDue(DRAW_AT);

    await expect(readEntry(13)).resolves.toMatchObject({
      status: 'drawn',
      entitlementSource: 'payment',
      closedAt: DRAW_AT,
      classifiedYear: YEAR,
    });
    await expect(readEntry(14)).resolves.toMatchObject({
      status: 'drawn',
      entitlementSource: 'ultras',
      entitledAt: DRAW_AT,
      classifiedYear: YEAR,
    });
  });
});
