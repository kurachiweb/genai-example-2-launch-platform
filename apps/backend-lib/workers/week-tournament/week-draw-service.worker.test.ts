import type { Event } from '@sentry/cloudflare';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { products } from '../../../db/schema/product/products.ts';
import { weekTournamentEntries } from '../../../db/schema/tournament/week-tournament-entries.ts';
import { weekTournaments } from '../../../db/schema/tournament/week-tournaments.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import type { FulfillmentPlan } from '../payments/fulfillment-contract.ts';
import {
  createRecordingDatabase,
  expectWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { insertMatches, matchIdOf } from '../match/testing/match-fixtures.ts';
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
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import { D1WeekTournamentStore } from './d1-week-tournament-store.ts';
import {
  createDrawService,
  createEntitlements,
  DEADLINE_AT,
  decidedQualifierOn,
  DRAW_AT,
  DRAW_CATEGORY,
  ENTITLED_BY_PAYMENT,
  entryOf,
  LATE_ULTRAS_OWNER,
  PLAIN_OWNER,
  PURCHASE_ID,
  readEntry,
  readEntryByLaunch,
  readTournament,
  seedProducts,
  TOURNAMENT_ID,
  ULTRAS_OWNER,
  undecidedQualifierOn,
} from './testing/draw-service-fixtures.ts';
import {
  clearWeekTournamentTables,
  insertWeekEntries,
  insertWeekTournaments,
  WEEK_WINDOW,
} from './testing/week-tournament-fixtures.ts';
import { WeekEntryFulfillment } from './week-entry-fulfillment.ts';

const JUST_BEFORE_DRAW = new Date(DRAW_AT.getTime() - 60_000);

const LATER = new Date(DRAW_AT.getTime() + 600_000);

let logs: LogObject[] = [];
let events: Event[] = [];

function drawErrorLogs(): LogObject[] {
  return logs.filter(
    ({ category, level }) => category === DRAW_CATEGORY && level === 'error',
  );
}

beforeEach(async () => {
  logs = recordLogs();
  events = installRecordingSentry();
  await clearWeekTournamentTables();
  await insertUser(PLAIN_OWNER);
  await insertUser(ULTRAS_OWNER);
  await insertUser(LATE_ULTRAS_OWNER);
  await insertWeekTournaments([{ index: 1 }]);
});

afterEach(resetObservability);

describe('WeekTournamentDrawService.drawDue(組み合わせ決定の時刻)', () => {
  beforeEach(async () => {
    await seedProducts(PLAIN_OWNER, [1, 2]);
    await insertWeekEntries([
      entryOf(1, PLAIN_OWNER, ENTITLED_BY_PAYMENT),
      entryOf(2, PLAIN_OWNER),
    ]);
  });

  test('23:44には組み合わせ決定の対象にならず、週も枠も変えない', async () => {
    const { service, store } = createDrawService();

    await expect(service.drawDue(JUST_BEFORE_DRAW)).resolves.toEqual({
      drawn: [],
      failed: [],
    });

    expect(store.calls).toEqual([]);
    await expect(readTournament()).resolves.toEqual({
      status: 'open',
      drawStartedAt: null,
    });
    await expect(readEntry(1)).resolves.toMatchObject({ status: 'entitled' });
    await expect(readEntry(2)).resolves.toMatchObject({
      status: 'awaiting_payment',
    });
  });

  test('23:45に週を凍結し、資格を得た枠を組み合わせの対象、受付中の枠を期限切れに分類する', async () => {
    const { service } = createDrawService();

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [TOURNAMENT_ID],
      failed: [],
    });

    await expect(readTournament()).resolves.toEqual({
      status: 'drawing',
      drawStartedAt: DRAW_AT,
    });
    await expect(readEntry(1)).resolves.toMatchObject({
      status: 'drawn',
      closeReason: null,
      closedAt: DRAW_AT,
    });
    await expect(readEntry(2)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'deadline',
      closedAt: DRAW_AT,
      refundStatus: 'none',
    });
    expect(drawErrorLogs()).toEqual([]);
  });
});

describe('WeekTournamentDrawService.drawDue(枠の補完)', () => {
  const LOSER = { launch: 22, owner: PLAIN_OWNER };

  beforeEach(async () => {
    await seedProducts(
      PLAIN_OWNER,
      [21, 22, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35],
    );
    await seedProducts(ULTRAS_OWNER, [23]);
  });

  test('週の7日分の予選の勝利のうち枠の無いものに枠を作ってから分類し、他の週の勝利と未確定のマッチには作らない', async () => {
    await insertMatches([
      decidedQualifierOn(
        1,
        '2026-11-16',
        { launch: 21, owner: 1 },
        {
          launch: 31,
          owner: PLAIN_OWNER,
        },
      ),
      decidedQualifierOn(
        2,
        '2026-11-22',
        { launch: 23, owner: 2 },
        {
          launch: 32,
          owner: PLAIN_OWNER,
        },
      ),
      decidedQualifierOn(
        3,
        '2026-11-20',
        { launch: 24, owner: 1 },
        {
          launch: 33,
          owner: PLAIN_OWNER,
        },
      ),
      decidedQualifierOn(
        4,
        '2026-11-23',
        { launch: 25, owner: 1 },
        {
          launch: 34,
          owner: PLAIN_OWNER,
        },
      ),
      decidedQualifierOn(
        5,
        '2026-11-15',
        { launch: 26, owner: 1 },
        {
          launch: 35,
          owner: PLAIN_OWNER,
        },
      ),
      undecidedQualifierOn(6, '2026-11-18', [
        { launch: 27, owner: 1 },
        { launch: 28, owner: 1 },
      ]),
    ]);
    await insertWeekEntries([entryOf(24, PLAIN_OWNER)]);
    const { service, registered } = createDrawService();

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [TOURNAMENT_ID],
      failed: [],
    });

    expect(registered.toSorted()).toEqual([matchIdOf(1), matchIdOf(2)]);
    await expect(readEntryByLaunch(21)).resolves.toMatchObject({
      tournamentId: TOURNAMENT_ID,
      productId: productIdOf(21),
      ownerUserId: userIdOf(PLAIN_OWNER),
      launchDate: '2026-11-16',
      qualifierMatchId: matchIdOf(1),
      qualifierUpvoteCount: 12,
      qualifierLastUpvoteElapsedMs: 3_600_000,
      status: 'expired',
      closeReason: 'deadline',
    });
    await expect(readEntryByLaunch(23)).resolves.toMatchObject({
      tournamentId: TOURNAMENT_ID,
      launchDate: '2026-11-22',
      status: 'drawn',
      entitlementSource: 'ultras',
    });
    await expect(readEntry(24)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'deadline',
    });
    for (const launch of [25, 26, 27, 28, 31, 32, 33, 34, 35]) {
      await expect(readEntryByLaunch(launch)).resolves.toBeUndefined();
    }
    await expect(
      db.select({ weekStart: weekTournaments.weekStart }).from(weekTournaments),
    ).resolves.toEqual([{ weekStart: WEEK_WINDOW.weekStart }]);
    expect(
      events.filter(({ tags }) => tags?.tournament_incident === 'late-entry'),
    ).toEqual([]);
  });

  test('枠の補完は凍結の前に行う', async () => {
    await insertMatches([
      decidedQualifierOn(1, '2026-11-16', { launch: 21, owner: 1 }, LOSER),
    ]);
    const { service, store } = createDrawService();

    await service.drawDue(DRAW_AT);

    expect(store.calls.slice(0, 2)).toEqual(['insertEntry', 'freeze']);
  });

  test('凍結済みの週は補完をせず、凍結の日時を変えずに残りの枠を分類する', async () => {
    await insertMatches([
      decidedQualifierOn(1, '2026-11-16', { launch: 21, owner: 1 }, LOSER),
    ]);
    await db
      .update(weekTournaments)
      .set({ status: 'drawing', drawStartedAt: DRAW_AT })
      .where(eq(weekTournaments.id, TOURNAMENT_ID));
    await insertWeekEntries([
      entryOf(24, PLAIN_OWNER, {
        ...ENTITLED_BY_PAYMENT,
        status: 'drawn',
        closedAt: DRAW_AT,
      }),
      entryOf(25, PLAIN_OWNER, ENTITLED_BY_PAYMENT),
      entryOf(26, PLAIN_OWNER),
    ]);
    const { service, registered } = createDrawService();

    await expect(service.drawDue(LATER)).resolves.toEqual({
      drawn: [TOURNAMENT_ID],
      failed: [],
    });

    expect(registered).toEqual([]);
    await expect(readTournament()).resolves.toEqual({
      status: 'drawing',
      drawStartedAt: DRAW_AT,
    });
    await expect(readEntry(24)).resolves.toMatchObject({
      status: 'drawn',
      closedAt: DRAW_AT,
    });
    await expect(readEntry(25)).resolves.toMatchObject({
      status: 'drawn',
      closedAt: LATER,
    });
    await expect(readEntry(26)).resolves.toMatchObject({
      status: 'expired',
      closedAt: LATER,
    });
    await expect(readEntryByLaunch(21)).resolves.toBeUndefined();
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

describe('WeekTournamentDrawService.drawDue(凍結と同時の変更)', () => {
  test('凍結の直後に届いた削除・Ultrasの加入・決済の反映は何もせず、凍結した時点の枠がすべて分類の時点の判定で分類される', async () => {
    await seedProducts(PLAIN_OWNER, [1, 2]);
    await seedProducts(LATE_ULTRAS_OWNER, [3]);
    await insertWeekEntries([
      entryOf(1, PLAIN_OWNER),
      entryOf(2, PLAIN_OWNER, ENTITLED_BY_PAYMENT),
      entryOf(3, LATE_ULTRAS_OWNER),
    ]);
    const plan = await new WeekEntryFulfillment(
      new D1WeekTournamentStore(db),
      new D1ProductDirectory(db),
    ).prepare(
      {
        purchaseId: purchaseIdOf(1),
        userId: userIdOf(PLAIN_OWNER),
        kind: 'week_tournament_entry',
        targetId: launchIdOf(1),
        relatedId: launchIdOf(1),
        quantity: 1,
        amountTotal: 500,
        paymentRecordId: '01JC0REC0RD000000000000001',
        paidAt: new Date(DEADLINE_AT.getTime() - 60_000),
        stripeSubscriptionId: null,
      },
      db,
    );
    const entitlements = createEntitlements();
    // 決済期限の前に有効になった加入の知らせが、凍結の後に届く
    const activatedAt = new Date(DEADLINE_AT.getTime() - 60_000);
    const lifecycleStore = new D1WeekTournamentStore(db);
    const concurrent: Record<string, unknown> = {};
    const { service } = createDrawService({
      entitlements,
      afterFreeze: async () => {
        concurrent.fulfillment = await db.batch(fulfilledStatements(plan)).then(
          () => 'committed',
          (error: unknown) => String(error),
        );
        await db
          .update(products)
          .set({ deletedAt: DRAW_AT })
          .where(eq(products.id, productIdOf(2)));
        concurrent.forfeited = await lifecycleStore.forfeitByProduct(
          productIdOf(2),
          'deleted',
          DRAW_AT,
        );
        entitlements.activate(LATE_ULTRAS_OWNER, activatedAt);
        concurrent.granted = await lifecycleStore.grantByUltras(
          userIdOf(LATE_ULTRAS_OWNER),
          activatedAt,
          DRAW_AT,
        );
      },
    });

    await service.drawDue(DRAW_AT);

    expect(concurrent).toEqual({
      fulfillment: expect.stringMatching(
        /NOT NULL constraint failed: week_tournament_entries\.status/u,
      ) as unknown,
      forfeited: [],
      granted: [],
    });
    await expect(readEntry(1)).resolves.toMatchObject({
      status: 'expired',
      closeReason: 'deadline',
      purchaseId: null,
      closedAt: DRAW_AT,
    });
    await expect(readEntry(2)).resolves.toMatchObject({
      status: 'forfeited',
      closeReason: 'deleted',
      purchaseId: PURCHASE_ID,
      closedAt: DRAW_AT,
      refundStatus: 'pending',
    });
    await expect(readEntry(3)).resolves.toMatchObject({
      status: 'drawn',
      closeReason: null,
      entitlementSource: 'ultras',
      entitledAt: DRAW_AT,
      closedAt: DRAW_AT,
    });
  });
});

describe('WeekTournamentDrawService.drawDue(参加の多い週)', () => {
  test('参加200の分類を90件ずつ読み、バインド変数の上限に収めてすべての枠に記録する', async () => {
    const paidIndexes = Array.from(
      { length: 100 },
      (_, offset) => offset + 100,
    );
    const ultrasIndexes = Array.from(
      { length: 100 },
      (_, offset) => offset + 200,
    );
    await seedProducts(PLAIN_OWNER, paidIndexes);
    await seedProducts(ULTRAS_OWNER, ultrasIndexes);
    await insertWeekEntries([
      ...paidIndexes.map((index) =>
        entryOf(index, PLAIN_OWNER, ENTITLED_BY_PAYMENT),
      ),
      ...ultrasIndexes.map((index) => entryOf(index, ULTRAS_OWNER)),
    ]);
    const recording = createRecordingDatabase();
    const { service, store } = createDrawService({
      database: recording.database,
    });

    await expect(service.drawDue(DRAW_AT)).resolves.toEqual({
      drawn: [TOURNAMENT_ID],
      failed: [],
    });

    expect(store.classificationPageSizes).toEqual([90, 90, 20]);
    expect(store.classified).toHaveLength(200);
    expectWithinBindLimit(recording.placeholderCounts);
    const rows = await db
      .select({
        status: weekTournamentEntries.status,
        entitlementSource: weekTournamentEntries.entitlementSource,
        entitledAt: weekTournamentEntries.entitledAt,
      })
      .from(weekTournamentEntries);
    expect(rows).toHaveLength(200);
    expect(rows.every(({ status }) => status === 'drawn')).toBe(true);
    expect(
      rows.filter(
        ({ entitlementSource, entitledAt }) =>
          entitlementSource === 'ultras' &&
          entitledAt?.getTime() === DRAW_AT.getTime(),
      ),
    ).toHaveLength(100);
    expect(
      rows.filter(
        ({ entitlementSource, entitledAt }) =>
          entitlementSource === 'payment' &&
          entitledAt?.getTime() === T0.getTime(),
      ),
    ).toHaveLength(100);
  });
});
