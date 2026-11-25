import type { Event } from '@sentry/cloudflare';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { LogObject } from '../../core/logging/log-record.ts';
import {
  insertUser,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  createDrawService,
  DEADLINE_AT,
  DRAW_AT,
  DRAW_CATEGORY,
  ENTITLED_BY_PAYMENT,
  ENTITLED_BY_ULTRAS,
  entryOf,
  PLAIN_OWNER,
  PURCHASE_ID,
  readEntry,
  readTournament,
  seedProducts,
  SUSPENDED_OWNER,
  TOURNAMENT_ID,
  ULTRAS_OWNER,
  WON_AT,
} from './testing/draw-service-fixtures.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  weekTournamentIdOf,
} from './testing/week-tournament-fixtures.ts';

let logs: LogObject[] = [];
let events: Event[] = [];

// 1・2: 可視の決済・Ultrasの資格、3: 非公開化の決済の資格、4: 停止中の投稿者の決済の資格、5・6: 論理削除済みの決済・Ultrasの資格、
// 7・8・13: Ultrasの期間内の受付中(可視・非公開化・論理削除済み)、9・10: 特典の無い受付中(可視・非公開化)、
// 11: 決済期限の後に勝利が確定した受付中、12: 遅れた勝利の期限切れ、14: 論理削除済みの特典の無い受付中
beforeEach(async () => {
  logs = recordLogs();
  events = installRecordingSentry();
  await clearWeekTournamentTables();
  await insertUser(PLAIN_OWNER);
  await insertUser(ULTRAS_OWNER);
  await insertUser(SUSPENDED_OWNER, { status: 'suspended', suspendedAt: T0 });
  await insertWeekTournaments([{ index: 1 }]);
  await seedProducts(PLAIN_OWNER, [1, 2, 9, 12]);
  await seedProducts(PLAIN_OWNER, [3, 10], { hiddenAt: T0 });
  await seedProducts(PLAIN_OWNER, [5, 6, 14], { deletedAt: T0 });
  await seedProducts(SUSPENDED_OWNER, [4]);
  await seedProducts(ULTRAS_OWNER, [7, 11]);
  await seedProducts(ULTRAS_OWNER, [8], { hiddenAt: T0 });
  await seedProducts(ULTRAS_OWNER, [13], { deletedAt: T0 });
  await insertWeekEntries([
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
    entryOf(11, ULTRAS_OWNER, {
      wonAt: new Date(DEADLINE_AT.getTime() + 60_000),
    }),
    entryOf(12, PLAIN_OWNER, {
      status: 'expired',
      closeReason: 'late_entry',
      closedAt: T0,
    }),
    entryOf(13, ULTRAS_OWNER),
    entryOf(14, PLAIN_OWNER),
  ]);
});

afterEach(resetObservability);

describe('WeekTournamentDrawService.drawDue(分類)', () => {
  test('資格を得た枠は、可視なら組み合わせの対象、非公開化・停止なら除外、論理削除済みなら喪失とし、決済した枠だけを返金待ちにして返金を依頼する', async () => {
    const { service } = createDrawService();

    await service.drawDue(DRAW_AT);

    await expect(readEntry(1)).resolves.toEqual({
      status: 'drawn',
      closeReason: null,
      entitlementSource: 'payment',
      purchaseId: PURCHASE_ID,
      entitledAt: T0,
      closedAt: DRAW_AT,
      refundStatus: 'none',
    });
    await expect(readEntry(2)).resolves.toMatchObject({
      status: 'drawn',
      entitlementSource: 'ultras',
      entitledAt: T0,
      refundStatus: 'none',
    });
    for (const index of [3, 4]) {
      await expect(readEntry(index)).resolves.toMatchObject({
        status: 'excluded',
        closeReason: 'hidden_or_suspended',
        purchaseId: PURCHASE_ID,
        closedAt: DRAW_AT,
        refundStatus: 'requested',
      });
    }
    await expect(readEntry(5)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
      closedAt: DRAW_AT,
      refundStatus: 'requested',
    });
    await expect(readEntry(6)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
      refundStatus: 'not_needed',
    });
  });

  test('受付中の枠は勝利の確定から決済期限までにUltrasの期間があれば参加資格(Ultras)として同じ規則で分類し、それ以外は期限切れにする', async () => {
    const { service } = createDrawService();

    await service.drawDue(DRAW_AT);

    await expect(readEntry(7)).resolves.toEqual({
      status: 'drawn',
      closeReason: null,
      entitlementSource: 'ultras',
      purchaseId: null,
      entitledAt: DRAW_AT,
      closedAt: DRAW_AT,
      refundStatus: 'none',
    });
    await expect(readEntry(8)).resolves.toMatchObject({
      status: 'excluded',
      closeReason: 'hidden_or_suspended',
      entitlementSource: 'ultras',
      refundStatus: 'not_needed',
    });
    await expect(readEntry(13)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
      entitlementSource: 'ultras',
      refundStatus: 'not_needed',
    });
    for (const index of [9, 10, 11]) {
      await expect(readEntry(index)).resolves.toEqual({
        status: 'expired',
        closeReason: 'deadline',
        entitlementSource: null,
        purchaseId: null,
        entitledAt: null,
        closedAt: DRAW_AT,
        refundStatus: 'none',
      });
    }
  });

  test('Ultrasの判定は投稿者ごとの勝利の確定から決済期限までを問い合わせ、決済期限の後に確定した勝利は問い合わせない', async () => {
    const { service, queries } = createDrawService();

    await service.drawDue(DRAW_AT);

    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query.to).toEqual(DEADLINE_AT);
      expect(query.from.getTime()).toBeLessThanOrEqual(DEADLINE_AT.getTime());
    }
    expect(
      queries
        .filter(({ userIds }) => userIds.length === 1)
        .map(({ userIds, from }) => ({ userId: userIds[0], from })),
    ).toEqual(
      [7, 8, 13].map(() => ({ userId: userIdOf(ULTRAS_OWNER), from: WON_AT })),
    );
  });

  test('特典の無い受付中の枠はプロダクトの状態より先に期限切れと判定し、論理削除済みでも喪失にしない', async () => {
    const { service } = createDrawService();

    await service.drawDue(DRAW_AT);

    await expect(readEntry(14)).resolves.toEqual({
      status: 'expired',
      closeReason: 'deadline',
      entitlementSource: null,
      purchaseId: null,
      entitledAt: null,
      closedAt: DRAW_AT,
      refundStatus: 'none',
    });
  });

  test('分類済み・終了した枠は変えない', async () => {
    const { service } = createDrawService();

    await service.drawDue(DRAW_AT);

    await expect(readEntry(12)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'late_entry',
      closedAt: T0,
    });
  });

  test('凍結の後にだけ分類し、凍結に失敗した週は分類せずに失敗として返し、他の週を止めない', async () => {
    await insertWeekTournaments([{ index: 2, weekStart: '2026-11-09' }]);
    const { service, store } = createDrawService({
      failFreezeOf: weekTournamentIdOf(2),
    });

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [TOURNAMENT_ID],
      failed: [weekTournamentIdOf(2)],
    });

    expect(store.calls).toEqual([
      'freeze',
      'freeze',
      'listEntriesForClassification',
      'classify',
    ]);
    await expect(readTournament(2)).resolves.toEqual({
      status: 'open',
      drawStartedAt: null,
    });
    await expect(readEntry(1)).resolves.toMatchObject({ status: 'drawn' });
    expect(
      logs.filter(
        ({ category, level }) =>
          category === DRAW_CATEGORY && level === 'error',
      ),
    ).toEqual([
      expect.objectContaining({
        level: 'error',
        tournamentId: weekTournamentIdOf(2),
      }),
    ]);
    expect(events.map(({ tags }) => tags)).toEqual([
      expect.objectContaining({
        tournament_incident: 'draw-failed',
        tournament_id: weekTournamentIdOf(2),
      }),
    ]);
  });
});
