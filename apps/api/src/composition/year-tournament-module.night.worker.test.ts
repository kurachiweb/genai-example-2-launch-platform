import { resetSync } from '@logtape/logtape';
import { asc } from 'drizzle-orm';
import { ContainerModule } from 'inversify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { paymentPurchases } from '../../db/schema/payments/payment-purchases.ts';
import { paymentRefunds } from '../../db/schema/payments/payment-refunds.ts';
import { eveningSlot } from '../../lib/core/notifications/notification-slots.ts';
import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../lib/core/year-tournament/identifiers.ts';
import type {
  YearCalendar,
  YearDrawService,
} from '../../lib/core/year-tournament/ports.ts';
import { readSlotRow } from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import type {
  FulfillmentPlan,
  PurchaseFulfillment,
} from '../../lib/workers/payments/fulfillment-contract.ts';
import { purchaseIdOf } from '../../lib/workers/payments/testing/payment-store-fixtures.ts';
import {
  db,
  productIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { yearEntryIdOf } from '../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import {
  configureRecordingLogs,
  type LoggedObject,
} from '../../test/support/observability-recording.ts';
import {
  clearTimelineTables,
  EVENING_TIME,
  instantOf,
  progressDecidedWeekMatch,
  type PublishedEvent,
  readBracketRounds,
  readParticipantRefs,
  readPublishedEvents,
  readReadyParticipants,
  RECONCILIATION_TIME,
  reflectByWebhook,
  scheduledRunsOf,
  setClock,
  type Timeline,
} from '../../test/support/week-tournament-timeline.ts';
import {
  bracketIdOfYear,
  createYearTimeline,
  eveningFlushesOf,
  insertYearPurchase,
  readDecidedMatchIds,
  readYearEntries,
  readYearTournament,
  SAME_NIGHT_WEEK_ENTRIES,
  SAME_NIGHT_WEEK_FINAL_MATCH,
  sameNightWeekTournamentId,
  seedSameNightWeekFinal,
  seedYearEntrants,
  slotSnapshotOf,
  syncChampionsByDecidedWeekMatch,
  YEAR_DRAW_DATE,
  YEAR_FINAL_DATE,
  YEAR_FIRST_ROUND_DATE,
  YEAR_TIMELINE_JOB_PREFIXES,
} from '../../test/support/year-tournament-timeline.ts';
import { EVENING_BRACKET_PARTICIPANT } from '../application/week-tournament/week-tournament-jobs.ts';
import { YEAR_EVENING_BRACKET_PARTICIPANT } from '../application/year-tournament/year-tournament-jobs.ts';

// 枠1はUltrasで参加資格あり、枠2〜4は受付中で、それぞれ同じ番号の購入の決済が決済期限の前にStripeで完了している
const ULTRAS_ENTRY = 1;
const RECONCILED_ENTRY = 2;
const LATE_ENTRY = 3;
const FROZEN_ENTRY = 4;

const EVENING_SLOT = eveningSlot(parseBusinessDate(YEAR_DRAW_DATE));

const EVENING_AT = instantOf(YEAR_DRAW_DATE, EVENING_TIME);

const DEADLINE_DELAY_SECONDS = Math.ceil(
  (EVENING_SLOT.settleUntil.getTime() - EVENING_AT.getTime()) / 1000,
);

const DRAW_NIGHT_RUNS = [
  [
    { name: 'payments.checkout-reconciliation', result: 'succeeded' },
    { name: 'match-engine.match-settlement', result: 'succeeded' },
  ],
  [
    { name: 'match-engine.qualifier-pairing', result: 'succeeded' },
    { name: 'notifications.evening-dispatch', result: 'succeeded' },
    { name: 'tournament-week.evening-bracket', result: 'succeeded' },
    { name: 'tournament-year.evening-bracket', result: 'succeeded' },
  ],
];

const CHAMPION_PATHS = [
  ['確定のマッチイベントの処理', true],
  ['23:45のジョブ', false],
] as const;

let logs: LoggedObject[];

function runsOf(): ReturnType<typeof scheduledRunsOf> {
  return scheduledRunsOf(logs, YEAR_TIMELINE_JOB_PREFIXES);
}

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

// 付与の判断を返した直後に23:45の起動を動かし、23:45より前に支払われた決済の反映が組み合わせ決定の凍結と重なった状況を作る
function eveningRunDuringFirstPrepare(
  timeline: Timeline,
  plans: FulfillmentPlan['kind'][],
) {
  return {
    bindings: new ContainerModule(({ onActivation }) => {
      onActivation<PurchaseFulfillment>(
        YEAR_TOURNAMENT_TYPES.YearEntryFulfillment,
        (_context, fulfillment) => ({
          prepare: async (purchase, database) => {
            const plan = await fulfillment.prepare(purchase, database);
            plans.push(plan.kind);
            if (plans.length === 1) {
              await timeline.run(YEAR_DRAW_DATE, EVENING_TIME);
            }
            return plan;
          },
        }),
      );
    }),
  };
}

// Yearトーナメントの組み合わせ決定が一時的に失敗する起動を作る
const failingYearDraw = {
  bindings: new ContainerModule(({ rebind }) => {
    rebind<YearDrawService>(
      YEAR_TOURNAMENT_TYPES.YearDrawService,
    ).toConstantValue({
      drawDue: () => Promise.reject(new Error('組み合わせ決定の一時的な失敗')),
    });
  }),
};

async function championEntry() {
  return (await readYearEntries()).find(
    ({ weekTournamentId }) => weekTournamentId === sameNightWeekTournamentId(),
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

describe('決済期限から組み合わせ決定までの時刻の連鎖', () => {
  test('23:40の突合で反映した決済は組み合わせに入り、凍結と重なった反映と23:45より後の支払いは自動で返金されて組み合わせに入らない', async () => {
    const timeline = createYearTimeline();
    await seedYearEntrants([
      { index: ULTRAS_ENTRY, entitled: true },
      { index: RECONCILED_ENTRY, entitled: false },
      { index: LATE_ENTRY, entitled: false },
      { index: FROZEN_ENTRY, entitled: false },
    ]);
    for (const index of [RECONCILED_ENTRY, LATE_ENTRY, FROZEN_ENTRY]) {
      await insertYearPurchase(index);
    }
    // 23:40の突合では2件の照会が一時的に失敗し、支払いの通知が後から届く
    timeline.stripeUnavailable.add(LATE_ENTRY).add(FROZEN_ENTRY);

    await timeline.run(YEAR_DRAW_DATE, RECONCILIATION_TIME);

    expect(await readYearEntries()).toContainEqual(
      expect.objectContaining({
        id: yearEntryIdOf(RECONCILED_ENTRY),
        status: 'entitled',
        entitlementSource: 'payment',
        purchaseId: purchaseIdOf(RECONCILED_ENTRY),
      }),
    );

    timeline.stripeUnavailable.clear();
    const plans: FulfillmentPlan['kind'][] = [];
    setClock(instantOf(YEAR_DRAW_DATE, { hour: 23, minute: 44 }, 59));
    const frozenOutcome = await reflectByWebhook(
      timeline.container([eveningRunDuringFirstPrepare(timeline, plans)]),
      FROZEN_ENTRY,
    );
    setClock(instantOf(YEAR_DRAW_DATE, { hour: 23, minute: 50 }));
    const lateOutcome = await reflectByWebhook(
      timeline.container(),
      LATE_ENTRY,
    );

    expect(runsOf()).toEqual(DRAW_NIGHT_RUNS);
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
    expect(
      (await readYearEntries()).map(
        ({ id, status, closeReason, entitlementSource, purchaseId }) => ({
          id,
          status,
          closeReason,
          entitlementSource,
          purchaseId,
        }),
      ),
    ).toEqual([
      {
        id: yearEntryIdOf(ULTRAS_ENTRY),
        status: 'drawn',
        closeReason: null,
        entitlementSource: 'ultras',
        purchaseId: null,
      },
      {
        id: yearEntryIdOf(RECONCILED_ENTRY),
        status: 'drawn',
        closeReason: null,
        entitlementSource: 'payment',
        purchaseId: purchaseIdOf(RECONCILED_ENTRY),
      },
      {
        id: yearEntryIdOf(LATE_ENTRY),
        status: 'expired',
        closeReason: 'deadline',
        entitlementSource: null,
        purchaseId: null,
      },
      {
        id: yearEntryIdOf(FROZEN_ENTRY),
        status: 'expired',
        closeReason: 'deadline',
        entitlementSource: null,
        purchaseId: null,
      },
    ]);
    const bracketId = await bracketIdOfYear();
    expect(await readParticipantRefs(bracketId)).toEqual([
      yearEntryIdOf(ULTRAS_ENTRY),
      yearEntryIdOf(RECONCILED_ENTRY),
    ]);
    expect(await readBracketRounds(bracketId)).toEqual([
      expect.objectContaining({
        round: 1,
        matchDate: YEAR_FINAL_DATE,
        kind: 'year',
        startedAt: null,
        decidedAt: null,
      }),
    ]);
  });

  test.each(CHAMPION_PATHS)(
    '組み合わせ決定の日の決勝で決まったWeek優勝は、%sが取り込んでも翌年の対象になり組み合わせに入らない',
    async (_path, byDecidedEvent) => {
      const timeline = createYearTimeline();
      await seedYearEntrants([
        { index: ULTRAS_ENTRY, entitled: true },
        { index: RECONCILED_ENTRY, entitled: true },
      ]);
      await seedSameNightWeekFinal();

      await timeline.run(YEAR_DRAW_DATE, RECONCILIATION_TIME);
      if (byDecidedEvent) {
        const decidedAt = instantOf(YEAR_DRAW_DATE, { hour: 23, minute: 41 });
        setClock(decidedAt);
        expect(await readDecidedMatchIds('week')).toEqual([
          SAME_NIGHT_WEEK_FINAL_MATCH,
        ]);
        await progressDecidedWeekMatch(
          timeline.container(),
          SAME_NIGHT_WEEK_FINAL_MATCH,
        );
        // 同じイベントのYearの取り込みは、Weekの優勝の記録の処理の後に動く
        setClock(instantOf(YEAR_DRAW_DATE, { hour: 23, minute: 41 }, 1));
        await syncChampionsByDecidedWeekMatch(timeline.container(), decidedAt);
        expect(await championEntry()).toMatchObject({
          status: 'awaiting_payment',
        });
      }
      await timeline.run(YEAR_DRAW_DATE, EVENING_TIME);

      const champion = await championEntry();
      expect(runsOf().at(-1)).toEqual(DRAW_NIGHT_RUNS[1]);
      expect(champion).toEqual({
        id: champion?.id,
        weekTournamentId: sameNightWeekTournamentId(),
        status: 'awaiting_payment',
        closeReason: null,
        entitlementSource: null,
        purchaseId: null,
        awardedDate: YEAR_DRAW_DATE,
        classifiedYear: null,
      });
      const resolution = await timeline
        .container()
        .get<YearCalendar>(YEAR_TOURNAMENT_TYPES.YearCalendar)
        .resolveAward(YEAR_DRAW_DATE, EVENING_AT);
      expect(resolution).toMatchObject({
        kind: 'open',
        year: { year: 2028 },
      });
      expect(await readParticipantRefs(await bracketIdOfYear())).toEqual([
        yearEntryIdOf(ULTRAS_ENTRY),
        yearEntryIdOf(RECONCILED_ENTRY),
      ]);
    },
  );
});

describe('夜の送り出しの準備の完了(notificationsの実際のEveningDispatchGate)', () => {
  async function seedDrawNight(): Promise<void> {
    await seedYearEntrants(
      [1, 2, 3, 4].map((index) => ({ index, entitled: true })),
    );
    await seedSameNightWeekFinal();
  }

  async function yearFirstRoundMatchIds(): Promise<string[]> {
    return (await readBracketRounds(await bracketIdOfYear()))
      .filter(({ round }) => round === 1)
      .map(({ matchId }) => matchId);
  }

  function drawNightEventsOf(
    yearFirstRound: readonly string[],
  ): PublishedEvent[] {
    return [
      { type: 'award', subject: productIdOf(SAME_NIGHT_WEEK_ENTRIES[0]) },
      ...yearFirstRound.toSorted().map((matchId) => ({
        type: 'match_preview',
        subject: matchId,
      })),
      { type: 'match_result', subject: SAME_NIGHT_WEEK_FINAL_MATCH },
    ];
  }

  test('組み合わせ決定の夜は、Weekの結果と受賞とYearの1回戦の予告を全て発行した後でYearが準備の完了を記録し、Weekの準備の完了とそろって送り出しを依頼する', async () => {
    const timeline = createYearTimeline({
      inspect: slotSnapshotOf(EVENING_SLOT.key),
    });
    await seedDrawNight();

    await timeline.run(YEAR_DRAW_DATE, RECONCILIATION_TIME);
    await timeline.run(YEAR_DRAW_DATE, EVENING_TIME);

    const yearFirstRound = await yearFirstRoundMatchIds();
    expect(runsOf()).toEqual(DRAW_NIGHT_RUNS);
    expect(await readYearTournament()).toMatchObject({
      status: 'in_progress',
      participantCount: 4,
      firstRoundDate: YEAR_FIRST_ROUND_DATE,
    });
    expect(yearFirstRound).toHaveLength(2);
    expect(eveningFlushesOf(timeline, EVENING_SLOT.key)).toEqual([
      {
        delaySeconds: DEADLINE_DELAY_SECONDS,
        snapshot: { events: [], ready: [] },
      },
      {
        delaySeconds: 0,
        snapshot: {
          events: drawNightEventsOf(yearFirstRound),
          ready: [
            EVENING_BRACKET_PARTICIPANT,
            YEAR_EVENING_BRACKET_PARTICIPANT,
          ],
        },
      },
    ]);
  });

  test('Yearの夜の処理が失敗した夜は準備の完了を記録せず、Weekの準備の完了だけでは送り出しを依頼せずに23:55の期限の送り出しに任せ、再実行で準備の完了を記録する', async () => {
    const timeline = createYearTimeline({
      inspect: slotSnapshotOf(EVENING_SLOT.key),
    });
    await seedDrawNight();

    await timeline.run(YEAR_DRAW_DATE, RECONCILIATION_TIME);
    await timeline.run(YEAR_DRAW_DATE, EVENING_TIME, [failingYearDraw]);

    expect(runsOf().at(-1)).toEqual([
      { name: 'match-engine.qualifier-pairing', result: 'succeeded' },
      { name: 'notifications.evening-dispatch', result: 'succeeded' },
      { name: 'tournament-week.evening-bracket', result: 'succeeded' },
      { name: 'tournament-year.evening-bracket', result: 'failed' },
    ]);
    expect(await readReadyParticipants(EVENING_SLOT.key)).toEqual([
      EVENING_BRACKET_PARTICIPANT,
    ]);
    expect(await readSlotRow(EVENING_SLOT.key)).toMatchObject({
      dispatchRequestedAt: null,
    });
    expect(EVENING_SLOT.settleUntil).toEqual(
      instantOf(YEAR_DRAW_DATE, { hour: 23, minute: 55 }),
    );
    expect(eveningFlushesOf(timeline, EVENING_SLOT.key)).toEqual([
      {
        delaySeconds: DEADLINE_DELAY_SECONDS,
        snapshot: { events: [], ready: [] },
      },
    ]);
    expect(await readYearTournament()).toMatchObject({
      status: 'open',
      bracketId: null,
    });

    await timeline.run(YEAR_DRAW_DATE, EVENING_TIME);

    const yearFirstRound = await yearFirstRoundMatchIds();
    expect(runsOf().at(-1)).toEqual(DRAW_NIGHT_RUNS[1]);
    expect(eveningFlushesOf(timeline, EVENING_SLOT.key)).toEqual([
      {
        delaySeconds: DEADLINE_DELAY_SECONDS,
        snapshot: { events: [], ready: [] },
      },
      {
        delaySeconds: 0,
        snapshot: {
          events: drawNightEventsOf(yearFirstRound),
          ready: [
            EVENING_BRACKET_PARTICIPANT,
            YEAR_EVENING_BRACKET_PARTICIPANT,
          ],
        },
      },
    ]);
    expect(await readPublishedEvents()).toEqual(
      drawNightEventsOf(yearFirstRound),
    );
  });
});
