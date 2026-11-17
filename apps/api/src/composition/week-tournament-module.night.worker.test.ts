import { resetSync } from '@logtape/logtape';
import { asc } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { paymentPurchases } from '../../db/schema/payments/payment-purchases.ts';
import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import { matchWindow } from '../../lib/core/match/match-model.ts';
import { FLUSH_NOTIFICATION_SLOT_MESSAGE } from '../../lib/core/messaging/contracts/notifications.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { eveningSlot } from '../../lib/core/notifications/notification-slots.ts';
import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import { WEEK_TOURNAMENT_TYPES } from '../../lib/core/week-tournament/identifiers.ts';
import { entryWindowFor } from '../../lib/core/week-tournament/week-schedule.ts';
import {
  insertMatches,
  matchIdOf,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import type {
  FulfillmentPlan,
  PurchaseFulfillment,
} from '../../lib/workers/payments/fulfillment-contract.ts';
import { purchaseIdOf } from '../../lib/workers/payments/testing/payment-store-fixtures.ts';
import {
  db,
  insertLaunches,
  insertProducts,
  productIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import {
  bracketIdOf,
  insertBracketMatches,
  insertBrackets,
  insertParticipants,
} from '../../lib/workers/tournament/testing/bracket-fixtures.ts';
import {
  insertWeekEntries,
  insertWeekTournaments,
  weekEntryIdOf,
} from '../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from '../../test/support/observability-recording.ts';
import {
  castVotes,
  clearTimelineTables,
  createTimeline,
  DRAW_DATE,
  EVENING_TIME,
  FIRST_ROUND_DATE,
  insertWeekPurchase,
  instantOf,
  KICKOFF_TIME,
  OWNER,
  type PublishedEvent,
  readBracketRounds,
  readEntryStatuses,
  readParticipantRefs,
  readPublishedEvents,
  readReadyParticipants,
  readWeekTournament,
  RECONCILIATION_TIME,
  reflectByWebhook,
  scheduledRunsOf,
  seedWeekEntrants,
  setClock,
  type Timeline,
} from '../../test/support/week-tournament-timeline.ts';
import { EVENING_BRACKET_PARTICIPANT } from '../application/week-tournament/week-tournament-jobs.ts';
import { YEAR_EVENING_BRACKET_PARTICIPANT } from '../application/year-tournament/year-tournament-jobs.ts';

interface SlotSnapshot {
  readonly events: readonly PublishedEvent[];
  readonly ready: readonly string[];
}

// 枠1はUltrasで参加資格あり、枠2〜4は受付中で、それぞれ同じ番号の購入の決済が決済期限の前にStripeで完了している
const ULTRAS_ENTRY = 1;
const RECONCILED_ENTRY = 2;
const LATE_ENTRY = 3;
const FROZEN_ENTRY = 4;

const EVENING_SLOT = eveningSlot(parseBusinessDate(DRAW_DATE));

const EVENING_AT = instantOf(DRAW_DATE, EVENING_TIME);

// 前の週のトーナメント(2026-11-09の週)は、組み合わせ決定の月曜日に決勝を戦う
const PREVIOUS_WEEK = 2;
const PREVIOUS_WEEK_WINDOW = entryWindowFor(parseBusinessDate('2026-11-09'));
const PREVIOUS_FINAL_MATCH = matchIdOf(900);
const PREVIOUS_ENTRIES = [11, 12] as const;

const MONDAY_NIGHT_RUNS = [
  [
    { name: 'payments.checkout-reconciliation', result: 'succeeded' },
    { name: 'match-engine.match-settlement', result: 'succeeded' },
  ],
  [
    { name: 'match-engine.qualifier-pairing', result: 'succeeded' },
    { name: 'notifications.evening-dispatch', result: 'succeeded' },
    { name: 'tournament-week.evening-bracket', result: 'succeeded' },
  ],
];

let logs: LoggedObject[];

async function readPurchases() {
  return db
    .select({
      id: paymentPurchases.id,
      status: paymentPurchases.status,
      rejectionReason: paymentPurchases.rejectionReason,
    })
    .from(paymentPurchases)
    .orderBy(asc(paymentPurchases.id));
}

async function readRefunds() {
  return db
    .select({
      purchaseId: paymentRefunds.purchaseId,
      reason: paymentRefunds.reason,
      amount: paymentRefunds.amount,
    })
    .from(paymentRefunds)
    .orderBy(asc(paymentRefunds.purchaseId));
}

async function bracketIdOfWeek(): Promise<string> {
  const bracketId = (await readWeekTournament())?.bracketId;
  if (bracketId == null) {
    throw new Error('週のトーナメントにブラケットがありません');
  }
  return bracketId;
}

// 付与の判断を返した直後に23:45の起動を動かし、23:45より前に支払われた決済の反映が組み合わせ決定の凍結と重なった状況を作る
function eveningRunDuringFirstPrepare(
  timeline: Timeline,
  plans: FulfillmentPlan['kind'][],
) {
  return {
    bindings: new ContainerModule(({ onActivation }) => {
      onActivation<PurchaseFulfillment>(
        WEEK_TOURNAMENT_TYPES.WeekEntryFulfillment,
        (_context, fulfillment) => ({
          prepare: async (purchase, database) => {
            const plan = await fulfillment.prepare(purchase, database);
            plans.push(plan.kind);
            if (plans.length === 1) {
              await timeline.run(DRAW_DATE, EVENING_TIME);
            }
            return plan;
          },
        }),
      );
    }),
  };
}

function eveningFlushesOf(timeline: Timeline) {
  return timeline.queued
    .filter(
      ({ envelope }) =>
        envelope.type === FLUSH_NOTIFICATION_SLOT_MESSAGE.type &&
        (envelope.body as { readonly slotKey: string }).slotKey ===
          EVENING_SLOT.key,
    )
    .map(({ delaySeconds, snapshot }) => ({ delaySeconds, snapshot }));
}

async function snapshotEveningSlot(
  envelope: QueueEnvelope,
): Promise<SlotSnapshot | undefined> {
  if (envelope.type !== FLUSH_NOTIFICATION_SLOT_MESSAGE.type) {
    return undefined;
  }
  return {
    events: await readPublishedEvents(),
    ready: await readReadyParticipants(EVENING_SLOT.key),
  };
}

// 前の週の決勝(参加2)を、当日の0:00に開始して側1に票が多い状態で用意する
async function seedPreviousWeekFinal(): Promise<void> {
  const window = matchWindow(parseBusinessDate(DRAW_DATE));
  await insertProducts(PREVIOUS_ENTRIES, OWNER);
  await insertLaunches(
    PREVIOUS_ENTRIES.map((index) => ({
      index,
      productIndex: index,
      columns: { launchDate: '2026-11-13' },
    })),
  );
  await insertBrackets([
    {
      index: PREVIOUS_WEEK,
      participantCount: 2,
      columns: { firstRoundDate: DRAW_DATE },
    },
  ]);
  await insertParticipants(
    PREVIOUS_ENTRIES.map((entry, position) => ({
      index: entry,
      bracket: PREVIOUS_WEEK,
      participantNo: position + 1,
      entry,
      launch: entry,
      product: entry,
      owner: OWNER,
    })),
  );
  await insertMatches([
    {
      index: 900,
      columns: {
        kind: 'week',
        round: 1,
        stage: 'final',
        matchDate: DRAW_DATE,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        startedAt: window.startsAt,
      },
      entries: PREVIOUS_ENTRIES.map((entry) => ({
        index: 9000 + entry,
        launch: entry,
        product: entry,
        owner: OWNER,
      })),
    },
  ]);
  await castVotes(PREVIOUS_FINAL_MATCH);
  await insertBracketMatches([
    {
      index: 1,
      bracket: PREVIOUS_WEEK,
      round: 1,
      position: 1,
      participantNos: [1, 2],
      columns: { matchId: PREVIOUS_FINAL_MATCH, matchDate: DRAW_DATE },
    },
  ]);
  await insertWeekTournaments([
    {
      index: PREVIOUS_WEEK,
      weekStart: PREVIOUS_WEEK_WINDOW.weekStart,
      columns: {
        status: 'in_progress',
        drawStartedAt: PREVIOUS_WEEK_WINDOW.drawAt,
        drawnAt: PREVIOUS_WEEK_WINDOW.drawAt,
        bracketId: bracketIdOf(PREVIOUS_WEEK),
      },
    },
  ]);
  await insertWeekEntries(
    PREVIOUS_ENTRIES.map((entry) => ({
      index: entry,
      tournament: PREVIOUS_WEEK,
      launch: entry,
      product: entry,
      owner: OWNER,
      columns: {
        launchDate: '2026-11-13',
        status: 'drawn',
        entitlementSource: 'ultras',
        entitledAt: PREVIOUS_WEEK_WINDOW.deadlineAt,
      },
    })),
  );
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  await clearTimelineTables();
  logs = configureRecordingLogs();
});

afterEach(() => {
  vi.useRealTimers();
  resetSync();
});

describe('決済期限から翌日の開始までの時刻の連鎖', () => {
  test('23:40の突合で反映した決済は組み合わせに入り、23:45より後の支払いと凍結の後の反映は自動で返金されて組み合わせに入らず、組み合わせは翌日の0:00に始まる', async () => {
    const timeline = createTimeline();
    await seedWeekEntrants([
      { index: ULTRAS_ENTRY, entitled: true },
      { index: RECONCILED_ENTRY, entitled: false },
      { index: LATE_ENTRY, entitled: false },
      { index: FROZEN_ENTRY, entitled: false },
    ]);
    for (const index of [RECONCILED_ENTRY, LATE_ENTRY, FROZEN_ENTRY]) {
      await insertWeekPurchase(index);
    }
    // 23:40の突合では2件の照会が一時的に失敗し、支払いの通知が後から届く
    timeline.stripeUnavailable.add(LATE_ENTRY).add(FROZEN_ENTRY);

    await timeline.run(DRAW_DATE, RECONCILIATION_TIME);

    expect(await readEntryStatuses()).toContainEqual({
      id: weekEntryIdOf(RECONCILED_ENTRY),
      status: 'entitled',
      entitlementSource: 'payment',
      purchaseId: purchaseIdOf(RECONCILED_ENTRY),
    });

    timeline.stripeUnavailable.clear();
    const plans: FulfillmentPlan['kind'][] = [];
    setClock(instantOf(DRAW_DATE, { hour: 23, minute: 44 }, 59));
    const frozenOutcome = await reflectByWebhook(
      timeline.container([eveningRunDuringFirstPrepare(timeline, plans)]),
      FROZEN_ENTRY,
    );
    setClock(instantOf(DRAW_DATE, { hour: 23, minute: 50 }));
    const lateOutcome = await reflectByWebhook(
      timeline.container(),
      LATE_ENTRY,
    );
    await timeline.run(FIRST_ROUND_DATE, KICKOFF_TIME);

    expect(scheduledRunsOf(logs)).toEqual([
      MONDAY_NIGHT_RUNS[0],
      MONDAY_NIGHT_RUNS[1],
      [
        { name: 'match-engine.match-kickoff', result: 'succeeded' },
        { name: 'notifications.morning-dispatch', result: 'succeeded' },
      ],
    ]);
    expect(plans).toEqual(['fulfill', 'reject']);
    expect(frozenOutcome).toEqual({
      kind: 'applied',
      purchaseStatus: 'rejected',
    });
    expect(lateOutcome).toEqual({
      kind: 'applied',
      purchaseStatus: 'rejected',
    });
    expect(await readPurchases()).toEqual([
      {
        id: purchaseIdOf(RECONCILED_ENTRY),
        status: 'fulfilled',
        rejectionReason: null,
      },
      {
        id: purchaseIdOf(LATE_ENTRY),
        status: 'rejected',
        rejectionReason: 'late',
      },
      {
        id: purchaseIdOf(FROZEN_ENTRY),
        status: 'rejected',
        rejectionReason: 'ineligible',
      },
    ]);
    expect(await readRefunds()).toEqual([
      { purchaseId: purchaseIdOf(LATE_ENTRY), reason: 'late', amount: 1_100 },
      {
        purchaseId: purchaseIdOf(FROZEN_ENTRY),
        reason: 'ineligible',
        amount: 1_100,
      },
    ]);
    expect(await readEntryStatuses()).toEqual([
      {
        id: weekEntryIdOf(ULTRAS_ENTRY),
        status: 'drawn',
        entitlementSource: 'ultras',
        purchaseId: null,
      },
      {
        id: weekEntryIdOf(RECONCILED_ENTRY),
        status: 'drawn',
        entitlementSource: 'payment',
        purchaseId: purchaseIdOf(RECONCILED_ENTRY),
      },
      {
        id: weekEntryIdOf(LATE_ENTRY),
        status: 'expired',
        entitlementSource: null,
        purchaseId: null,
      },
      {
        id: weekEntryIdOf(FROZEN_ENTRY),
        status: 'expired',
        entitlementSource: null,
        purchaseId: null,
      },
    ]);
    const bracketId = await bracketIdOfWeek();
    expect(await readParticipantRefs(bracketId)).toEqual([
      weekEntryIdOf(ULTRAS_ENTRY),
      weekEntryIdOf(RECONCILED_ENTRY),
    ]);
    expect(await readBracketRounds(bracketId)).toEqual([
      expect.objectContaining({
        round: 1,
        matchDate: FIRST_ROUND_DATE,
        kind: 'week',
        startedAt: instantOf(FIRST_ROUND_DATE, KICKOFF_TIME),
        decidedAt: null,
      }),
    ]);
  });
});

describe('夜の送り出しの準備の完了(notificationsの実際のEveningDispatchGate)', () => {
  test('その夜の結果・翌日の予告・受賞を全て発行した後で準備の完了を記録し、それまでは期限の送り出しだけを予約して送り出しを依頼しない', async () => {
    const timeline = createTimeline({ inspect: snapshotEveningSlot });
    await seedWeekEntrants([
      { index: 1, entitled: true },
      { index: 2, entitled: true },
    ]);
    await seedPreviousWeekFinal();

    await timeline.run(DRAW_DATE, RECONCILIATION_TIME);
    await timeline.run(DRAW_DATE, EVENING_TIME);

    const [weekFinal] = await readBracketRounds(await bracketIdOfWeek());
    if (weekFinal === undefined) {
      throw new Error('組み合わせのマッチがありません');
    }
    const nightEvents: PublishedEvent[] = [
      {
        type: 'award',
        subject: productIdOf(PREVIOUS_ENTRIES[0]),
      },
      { type: 'match_preview', subject: weekFinal.matchId },
      { type: 'match_result', subject: PREVIOUS_FINAL_MATCH },
    ];
    expect(scheduledRunsOf(logs)).toEqual(MONDAY_NIGHT_RUNS);
    expect(weekFinal).toMatchObject({
      matchDate: FIRST_ROUND_DATE,
      startedAt: null,
    });
    expect(await readWeekTournament(PREVIOUS_WEEK)).toEqual({
      status: 'finished',
      bracketId: bracketIdOf(PREVIOUS_WEEK),
      outcome: 'awarded',
      championEntryId: weekEntryIdOf(PREVIOUS_ENTRIES[0]),
    });
    expect(eveningFlushesOf(timeline)).toEqual([
      {
        delaySeconds: Math.ceil(
          (EVENING_SLOT.settleUntil.getTime() - EVENING_AT.getTime()) / 1000,
        ),
        snapshot: { events: [], ready: [] },
      },
      {
        delaySeconds: 0,
        snapshot: {
          events: nightEvents,
          ready: [
            EVENING_BRACKET_PARTICIPANT,
            YEAR_EVENING_BRACKET_PARTICIPANT,
          ],
        },
      },
    ]);
    expect(await readPublishedEvents()).toEqual(nightEvents);

    await timeline.run(DRAW_DATE, EVENING_TIME);

    expect(scheduledRunsOf(logs).at(-1)).toEqual(MONDAY_NIGHT_RUNS[1]);
    expect(eveningFlushesOf(timeline)).toHaveLength(2);
    expect(await readPublishedEvents()).toEqual(nightEvents);
  });
});
