import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { products } from '../../../db/schema/product/products.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import type { FulfillmentPlan } from '../payments/fulfillment-contract.ts';
import { purchaseIdOf } from '../payments/testing/payment-store-fixtures.ts';
import { D1ProductDirectory } from '../product/d1-product-directory.ts';
import {
  db,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../product/testing/product-fixtures.ts';
import {
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import {
  createEntitlements,
  ENTITLED_BY_PAYMENT,
  LATE_ULTRAS_OWNER,
  PLAIN_OWNER,
  PURCHASE_ID,
  seedProducts,
  ULTRAS_OWNER,
} from '../week-tournament/testing/draw-service-fixtures.ts';
import { D1YearEntryStore } from './d1-year-entry-store.ts';
import { D1YearTournamentStore } from './d1-year-tournament-store.ts';
import {
  createDrawService,
  DEADLINE_AT,
  DRAW_AT,
  DRAW_CATEGORY,
  entryOf,
  markFrozen,
  readEntry,
  readTournament,
} from './testing/year-draw-fixtures.ts';
import {
  CHAMPION_1,
  CHAMPION_2,
  createRegistrarHarness,
} from './testing/year-entry-registrar-fixtures.ts';
import {
  clearYearTournamentTables,
  insertYearEntries,
  insertYearTournaments,
  YEAR,
  yearEntryIdOf,
} from './testing/year-tournament-fixtures.ts';
import { YearTournamentCalendar } from './year-calendar.ts';
import { YearEntryFulfillment } from './year-entry-fulfillment.ts';

const JUST_BEFORE_DRAW = new Date(DRAW_AT.getTime() - 60_000);

const LATER = new Date(DRAW_AT.getTime() + 600_000);

let logs: LogObject[] = [];

function drawErrorLogs(): LogObject[] {
  return logs.filter(
    ({ category, level }) => category === DRAW_CATEGORY && level === 'error',
  );
}

beforeEach(async () => {
  logs = recordLogs();
  await clearYearTournamentTables();
  await insertUser(PLAIN_OWNER);
  await insertUser(ULTRAS_OWNER);
  await insertUser(LATE_ULTRAS_OWNER);
  await insertYearTournaments([{ index: 1 }]);
});

afterEach(resetObservability);

describe('YearTournamentDrawService.drawDue(組み合わせ決定の時刻)', () => {
  beforeEach(async () => {
    await seedProducts(PLAIN_OWNER, [11, 12]);
    await insertYearEntries([
      entryOf(11, PLAIN_OWNER, ENTITLED_BY_PAYMENT),
      entryOf(12, PLAIN_OWNER),
    ]);
  });

  test('23:44には組み合わせ決定の対象にならず、補完も凍結もせずに年と枠を変えない', async () => {
    const { service, calls } = createDrawService();

    await expect(service.drawDue(JUST_BEFORE_DRAW)).resolves.toEqual({
      drawn: [],
      failed: [],
    });

    expect(calls).toEqual([]);
    await expect(readTournament()).resolves.toEqual({
      status: 'open',
      drawStartedAt: null,
    });
    await expect(readEntry(11)).resolves.toMatchObject({
      status: 'entitled',
      closedAt: null,
    });
    await expect(readEntry(12)).resolves.toMatchObject({
      status: 'awaiting_payment',
      closedAt: null,
    });
  });

  test('23:45に年を凍結し、参加資格の枠を組み合わせの対象、受付中の枠を期限切れに分類して終えた年を記録する', async () => {
    const { service, calls, tournaments } = createDrawService();

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [YEAR],
      failed: [],
    });

    expect(calls).toEqual([
      'syncChampions',
      'freeze',
      'listCandidates',
      'classify',
      'listDrawn',
      'excludeOverCapacity',
    ]);
    expect(tournaments.freezeOutcomes).toEqual(['frozen']);
    await expect(readTournament()).resolves.toEqual({
      status: 'drawing',
      drawStartedAt: DRAW_AT,
    });
    await expect(readEntry(11)).resolves.toEqual({
      status: 'drawn',
      closeReason: null,
      entitlementSource: 'payment',
      purchaseId: PURCHASE_ID,
      entitledAt: T0,
      closedAt: DRAW_AT,
      classifiedYear: YEAR,
      refundStatus: 'none',
    });
    await expect(readEntry(12)).resolves.toEqual({
      status: 'expired',
      closeReason: 'deadline',
      entitlementSource: null,
      purchaseId: null,
      entitledAt: null,
      closedAt: DRAW_AT,
      classifiedYear: YEAR,
      refundStatus: 'none',
    });
    expect(drawErrorLogs()).toEqual([]);
  });
});

describe('YearTournamentDrawService.drawDue(枠の補完)', () => {
  test('凍結の前に、起点を設けずにWeek優勝の枠を補完し、補完した枠も分類する', async () => {
    await seedProducts(PLAIN_OWNER, [1]);
    await seedProducts(ULTRAS_OWNER, [2]);
    const { service, calls, syncInputs } = createDrawService({
      champions: [CHAMPION_1, CHAMPION_2],
    });

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [YEAR],
      failed: [],
    });

    expect(syncInputs).toEqual([{ awardedFrom: null, now: DRAW_AT }]);
    expect(calls.slice(0, 2)).toEqual(['syncChampions', 'freeze']);
    await expect(readEntry(1)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'deadline',
      closedAt: DRAW_AT,
      classifiedYear: YEAR,
    });
    await expect(readEntry(2)).resolves.toMatchObject({
      status: 'drawn',
      entitlementSource: 'ultras',
      entitledAt: DRAW_AT,
      closedAt: DRAW_AT,
      classifiedYear: YEAR,
    });
  });
});

describe('YearTournamentDrawService.drawDue(凍結と再開)', () => {
  beforeEach(async () => {
    await seedProducts(PLAIN_OWNER, [1, 11, 12, 13]);
    await insertYearEntries([
      entryOf(11, PLAIN_OWNER, {
        ...ENTITLED_BY_PAYMENT,
        status: 'drawn',
        closedAt: DRAW_AT,
        classifiedYear: YEAR,
      }),
      entryOf(12, PLAIN_OWNER, ENTITLED_BY_PAYMENT),
      entryOf(13, PLAIN_OWNER),
    ]);
  });

  test('凍結済みの年は補完も凍結もせず、凍結の日時を変えずに残りの枠を分類する', async () => {
    await markFrozen(DRAW_AT);
    const { service, calls, syncInputs } = createDrawService({
      champions: [CHAMPION_1],
    });

    await expect(service.drawDue(LATER)).resolves.toEqual({
      drawn: [YEAR],
      failed: [],
    });

    expect(syncInputs).toEqual([]);
    expect(calls).not.toContain('freeze');
    await expect(readTournament()).resolves.toEqual({
      status: 'drawing',
      drawStartedAt: DRAW_AT,
    });
    await expect(readEntry(1)).resolves.toBeUndefined();
    await expect(readEntry(11)).resolves.toMatchObject({
      status: 'drawn',
      closedAt: DRAW_AT,
    });
    await expect(readEntry(12)).resolves.toMatchObject({
      status: 'drawn',
      closedAt: LATER,
      classifiedYear: YEAR,
    });
    await expect(readEntry(13)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'deadline',
      closedAt: LATER,
    });
  });

  test('一覧の後に別の実行が凍結した年は、凍結の日時を書き換えずに続きを分類する', async () => {
    const { service, tournaments } = createDrawService({
      beforeFreeze: () => markFrozen(DRAW_AT),
    });

    await expect(service.drawDue(LATER)).resolves.toEqual({
      drawn: [YEAR],
      failed: [],
    });

    expect(tournaments.freezeOutcomes).toEqual(['already']);
    await expect(readTournament()).resolves.toEqual({
      status: 'drawing',
      drawStartedAt: DRAW_AT,
    });
    await expect(readEntry(12)).resolves.toMatchObject({
      status: 'drawn',
      closedAt: LATER,
    });
    await expect(readEntry(13)).resolves.toMatchObject({
      status: 'expired',
      closedAt: LATER,
    });
  });
});

function fulfilledStatements(plan: FulfillmentPlan) {
  if (plan.kind !== 'fulfill') {
    throw new Error(`参加資格の付与を拒否しました: ${plan.reason}`);
  }
  const [first, ...rest] = plan.statements;
  if (first === undefined) {
    throw new Error('付与の文がありません');
  }
  return [first, ...rest] as const;
}

describe('YearTournamentDrawService.drawDue(凍結と同時の変更)', () => {
  test('凍結の直後に届いた決済の反映・削除・Ultrasの加入・Week優勝の取り込みは資格を変えず、凍結した時点の枠だけが分類の時点の判定で分類される', async () => {
    await seedProducts(PLAIN_OWNER, [1, 11, 12]);
    await seedProducts(LATE_ULTRAS_OWNER, [13]);
    await insertYearEntries([
      entryOf(11, PLAIN_OWNER),
      entryOf(12, PLAIN_OWNER, ENTITLED_BY_PAYMENT),
      entryOf(13, LATE_ULTRAS_OWNER),
    ]);
    const plan = await new YearEntryFulfillment(
      new D1YearEntryStore(db),
      new YearTournamentCalendar(new D1YearTournamentStore(db)),
      new D1ProductDirectory(db),
    ).prepare(
      {
        purchaseId: purchaseIdOf(1),
        userId: userIdOf(PLAIN_OWNER),
        kind: 'year_tournament_entry',
        targetId: launchIdOf(11),
        relatedId: launchIdOf(11),
        quantity: 1,
        amountTotal: 2000,
        paymentRecordId: '01JC0REC0RD000000000000001',
        paidAt: new Date(DEADLINE_AT.getTime() - 60_000),
        stripeSubscriptionId: null,
      },
      db,
    );
    const entitlements = createEntitlements();
    // 決済期限の前に有効になった加入の知らせが、凍結の後に届く
    const activatedAt = new Date(DEADLINE_AT.getTime() - 60_000);
    const lifecycleStore = new D1YearEntryStore(db);
    // 凍結の後に処理されたWeek優勝の知らせ
    const lateChampion = createRegistrarHarness({ champions: [CHAMPION_1] });
    const concurrent: Record<string, unknown> = {};
    const { service, entries } = createDrawService({
      entitlements,
      afterFreeze: async () => {
        concurrent.fulfillment = await db.batch(fulfilledStatements(plan)).then(
          () => 'committed',
          (error: unknown) => String(error),
        );
        await db
          .update(products)
          .set({ deletedAt: DRAW_AT })
          .where(eq(products.id, productIdOf(12)));
        concurrent.forfeited = await lifecycleStore.forfeitByProduct(
          productIdOf(12),
          DRAW_AT,
        );
        entitlements.activate(LATE_ULTRAS_OWNER, activatedAt);
        concurrent.granted = await lifecycleStore.grantByUltras(
          [yearEntryIdOf(13)],
          DRAW_AT,
        );
        concurrent.champions = await lateChampion.registrar.syncChampions({
          awardedFrom: null,
          now: DRAW_AT,
        });
      },
    });

    await service.drawDue(DRAW_AT);

    expect(concurrent).toEqual({
      fulfillment: expect.stringMatching(
        /NOT NULL constraint failed: year_tournament_entries\.status/u,
      ) as unknown,
      forfeited: [],
      granted: [],
      champions: { created: [], late: [yearEntryIdOf(1)], skipped: 0 },
    });
    expect(entries.classified.map(({ entryId }) => entryId)).toEqual([
      yearEntryIdOf(11),
      yearEntryIdOf(12),
      yearEntryIdOf(13),
    ]);
    await expect(readEntry(11)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'deadline',
      purchaseId: null,
      closedAt: DRAW_AT,
    });
    await expect(readEntry(12)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
      purchaseId: PURCHASE_ID,
      closedAt: DRAW_AT,
      refundStatus: 'pending',
    });
    await expect(readEntry(13)).resolves.toMatchObject({
      status: 'drawn',
      closeReason: null,
      entitlementSource: 'ultras',
      entitledAt: DRAW_AT,
      closedAt: DRAW_AT,
    });
    await expect(readEntry(1)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'late_entry',
      classifiedYear: YEAR,
      refundStatus: 'not_needed',
    });
  });
});
