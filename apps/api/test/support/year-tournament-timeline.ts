import { and, asc, eq } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';

import { matchEvents } from '../../db/schema/match/match-events.ts';
import { yearTournamentEntries } from '../../db/schema/tournament/year-tournament-entries.ts';
import { yearTournaments } from '../../db/schema/tournament/year-tournaments.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { matchWindow } from '../../lib/core/match/match-model.ts';
import { FLUSH_NOTIFICATION_SLOT_MESSAGE } from '../../lib/core/messaging/contracts/notifications.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import type { Clock } from '../../lib/core/time/clock.ts';
import { TOURNAMENT_PLATFORM_TYPES } from '../../lib/core/tournament/identifiers.ts';
import type { BracketStore } from '../../lib/core/tournament/ports.ts';
import { entryWindowFor } from '../../lib/core/week-tournament/week-schedule.ts';
import { YEAR_TOURNAMENT_TYPES } from '../../lib/core/year-tournament/identifiers.ts';
import type {
  YearEntryRegistrar,
  YearProgressionService,
  YearTournamentStore,
} from '../../lib/core/year-tournament/ports.ts';
import {
  insertMatches,
  matchIdOf,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import { insertPurchase } from '../../lib/workers/payments/testing/checkout-reflection-harness.ts';
import {
  db,
  insertLaunches,
  insertProducts,
  insertUser,
  launchIdOf,
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
  weekTournamentIdOf,
} from '../../lib/workers/week-tournament/testing/week-tournament-fixtures.ts';
import {
  insertYearEntries,
  insertYearTournaments,
  YEAR_SCHEDULE,
  yearTournamentIdOf,
} from '../../lib/workers/year-tournament/testing/year-tournament-fixtures.ts';
import {
  castVotes,
  createTimeline,
  type ModuleOverride,
  OWNER,
  readPublishedEvents,
  readReadyParticipants,
  TIMELINE_JOB_PREFIXES,
  type Timeline,
  type TimelineOptions,
} from './week-tournament-timeline.ts';

export interface SlotSnapshot {
  readonly events: Awaited<ReturnType<typeof readPublishedEvents>>;
  readonly ready: readonly string[];
}

// 2027年の決済期限日(5/24の月曜日)。決勝日は5/30で、参加4の1回戦(準決勝)は決勝日の前日になる
export const YEAR_DRAW_DATE = YEAR_SCHEDULE.deadlineDate;
export const YEAR_FIRST_ROUND_DATE = '2027-05-29';
export const YEAR_FINAL_DATE = YEAR_SCHEDULE.finalDate;

export const YEAR_TIMELINE_JOB_PREFIXES: readonly string[] = [
  ...TIMELINE_JOB_PREFIXES,
  'tournament-year.',
];

// 組み合わせ決定の日に決勝を戦うWeekトーナメント(2027-05-10の週)と、その参加の枠・ローンチ・プロダクトの番号
export const SAME_NIGHT_WEEK = 2;
export const SAME_NIGHT_WEEK_ENTRIES = [11, 12] as const;
export const SAME_NIGHT_WEEK_FINAL_MATCH = matchIdOf(900);

const SAME_NIGHT_WEEK_WINDOW = entryWindowFor(parseBusinessDate('2027-05-10'));
const SAME_NIGHT_WEEK_LAUNCH_DATE = '2027-05-14';
const SAME_NIGHT_QUALIFIER = 911;

const ENTITLED_AT = new Date('2026-11-24T07:45:00.000Z');

export interface YearEntrantFixture {
  readonly index: number;
  readonly entitled: boolean;
}

// 定期実行の時計は呼ぶたびに1ミリ秒進め、同じ起動の先のジョブが記録した時刻を後のジョブが「それより後」として読めるようにする
function advancingClock(): ModuleOverride {
  let ticks = 0;
  const clock: Clock = {
    now: () => {
      ticks += 1;
      return new Date(Date.now() + ticks);
    },
  };
  return {
    bindings: new ContainerModule(({ rebind }) => {
      rebind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(clock);
    }),
  };
}

// Yearトーナメント参加費の決済セッションを返し、定期実行の時計が進む時刻の連鎖
export function createYearTimeline(
  options: Omit<TimelineOptions, 'purchaseKind'> = {},
): Timeline {
  const timeline = createTimeline({
    ...options,
    purchaseKind: 'year_tournament_entry',
  });
  return {
    ...timeline,
    run: (date, time, extra = []) =>
      timeline.run(date, time, [advancingClock(), ...extra]),
  };
}

// 投稿者1の同じ番号のプロダクトとローンチで、2027年の受付中の年と枠を作る。参加資格を得た枠はUltrasによる
export async function seedYearEntrants(
  entrants: readonly YearEntrantFixture[],
): Promise<void> {
  const indexes = entrants.map(({ index }) => index);
  await insertUser(OWNER);
  await insertProducts(indexes, OWNER);
  await insertLaunches(
    indexes.map((index) => ({ index, productIndex: index })),
  );
  await insertYearTournaments([{ index: 1 }]);
  await insertYearEntries(
    entrants.map(({ index, entitled }) => ({
      index,
      launch: index,
      product: index,
      owner: OWNER,
      columns: entitled
        ? {
            status: 'entitled',
            entitlementSource: 'ultras',
            entitledAt: ENTITLED_AT,
          }
        : {},
    })),
  );
}

// 受付期限の前に開始した、同じ番号のローンチへのYearトーナメント参加費の未完了の購入と決済セッション
export async function insertYearPurchase(index: number): Promise<void> {
  await insertPurchase(index, {
    kind: 'year_tournament_entry',
    targetId: launchIdOf(index),
    relatedId: launchIdOf(index),
    exclusivityKey: `launch:${launchIdOf(index)}:year`,
    priceLookupKey: 'year_tournament_entry',
    deadlineAt: YEAR_SCHEDULE.deadlineAt,
    acceptUntil: YEAR_SCHEDULE.acceptUntil,
    fulfillableUntil: YEAR_SCHEDULE.drawAt,
  });
}

// 組み合わせ決定の日の0:00に始まり側1に票が多いWeekの決勝(参加2)と、側1のローンチが勝った予選を用意する
export async function seedSameNightWeekFinal(): Promise<void> {
  const window = matchWindow(parseBusinessDate(YEAR_DRAW_DATE));
  const qualifierWindow = matchWindow(
    parseBusinessDate(SAME_NIGHT_WEEK_LAUNCH_DATE),
  );
  const [champion] = SAME_NIGHT_WEEK_ENTRIES;
  await insertProducts(SAME_NIGHT_WEEK_ENTRIES, OWNER);
  await insertLaunches(
    SAME_NIGHT_WEEK_ENTRIES.map((index) => ({
      index,
      productIndex: index,
      columns: { launchDate: SAME_NIGHT_WEEK_LAUNCH_DATE },
    })),
  );
  await insertMatches([
    {
      index: SAME_NIGHT_QUALIFIER,
      columns: {
        matchDate: SAME_NIGHT_WEEK_LAUNCH_DATE,
        startsAt: qualifierWindow.startsAt,
        endsAt: qualifierWindow.endsAt,
        startedAt: qualifierWindow.startsAt,
        decidedAt: qualifierWindow.endsAt,
      },
      entries: [
        {
          index: SAME_NIGHT_QUALIFIER * 10 + 1,
          launch: champion,
          product: champion,
          owner: OWNER,
          columns: { result: 'won', upvoteCount: 5 },
        },
        {
          index: SAME_NIGHT_QUALIFIER * 10 + 2,
          launch: null,
          product: null,
          owner: null,
          columns: { result: 'lost', upvoteCount: 2 },
        },
      ],
    },
  ]);
  await insertBrackets([
    {
      index: SAME_NIGHT_WEEK,
      participantCount: 2,
      columns: { firstRoundDate: YEAR_DRAW_DATE },
    },
  ]);
  await insertParticipants(
    SAME_NIGHT_WEEK_ENTRIES.map((entry, position) => ({
      index: entry,
      bracket: SAME_NIGHT_WEEK,
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
        matchDate: YEAR_DRAW_DATE,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        startedAt: window.startsAt,
      },
      entries: SAME_NIGHT_WEEK_ENTRIES.map((entry) => ({
        index: 9000 + entry,
        launch: entry,
        product: entry,
        owner: OWNER,
      })),
    },
  ]);
  await castVotes(SAME_NIGHT_WEEK_FINAL_MATCH);
  await insertBracketMatches([
    {
      index: 1,
      bracket: SAME_NIGHT_WEEK,
      round: 1,
      position: 1,
      participantNos: [1, 2],
      columns: {
        matchId: SAME_NIGHT_WEEK_FINAL_MATCH,
        matchDate: YEAR_DRAW_DATE,
      },
    },
  ]);
  await insertWeekTournaments([
    {
      index: SAME_NIGHT_WEEK,
      weekStart: SAME_NIGHT_WEEK_WINDOW.weekStart,
      columns: {
        status: 'in_progress',
        drawStartedAt: SAME_NIGHT_WEEK_WINDOW.drawAt,
        drawnAt: SAME_NIGHT_WEEK_WINDOW.drawAt,
        bracketId: bracketIdOf(SAME_NIGHT_WEEK),
      },
    },
  ]);
  await insertWeekEntries(
    SAME_NIGHT_WEEK_ENTRIES.map((entry) => ({
      index: entry,
      tournament: SAME_NIGHT_WEEK,
      launch: entry,
      product: entry,
      owner: OWNER,
      columns: {
        launchDate: SAME_NIGHT_WEEK_LAUNCH_DATE,
        status: 'drawn',
        entitlementSource: 'ultras',
        entitledAt: SAME_NIGHT_WEEK_WINDOW.deadlineAt,
      },
    })),
  );
}

export function sameNightWeekTournamentId(): string {
  return weekTournamentIdOf(SAME_NIGHT_WEEK);
}

export async function readYearTournament(index = 1) {
  const [row] = await db
    .select({
      status: yearTournaments.status,
      bracketId: yearTournaments.bracketId,
      participantCount: yearTournaments.participantCount,
      firstRoundDate: yearTournaments.firstRoundDate,
    })
    .from(yearTournaments)
    .where(eq(yearTournaments.id, yearTournamentIdOf(index)));
  return row;
}

export async function bracketIdOfYear(): Promise<string> {
  const bracketId = (await readYearTournament())?.bracketId;
  if (bracketId == null) {
    throw new Error('2027年のYearトーナメントにブラケットがありません');
  }
  return bracketId;
}

export async function readYearEntries() {
  return db
    .select({
      id: yearTournamentEntries.id,
      weekTournamentId: yearTournamentEntries.weekTournamentId,
      status: yearTournamentEntries.status,
      closeReason: yearTournamentEntries.closeReason,
      entitlementSource: yearTournamentEntries.entitlementSource,
      purchaseId: yearTournamentEntries.purchaseId,
      awardedDate: yearTournamentEntries.awardedDate,
      classifiedYear: yearTournamentEntries.classifiedYear,
    })
    .from(yearTournamentEntries)
    .orderBy(asc(yearTournamentEntries.id));
}

export async function readDecidedMatchIds(
  kind: 'week' | 'year',
): Promise<string[]> {
  const rows = await db
    .select({ matchId: matchEvents.matchId })
    .from(matchEvents)
    .where(
      and(eq(matchEvents.type, 'decided'), eq(matchEvents.matchKind, kind)),
    )
    .orderBy(asc(matchEvents.matchId));
  return rows.map(({ matchId }) => matchId);
}

// eventの確定のマッチイベントの処理(RoundProgressHandler)と同じく、マッチのブラケットの年を進めて結果と予告を発行する
export async function progressDecidedYearMatch(
  container: Container,
  matchId: string,
): Promise<void> {
  const bracket = (
    await container
      .get<BracketStore>(TOURNAMENT_PLATFORM_TYPES.BracketStore)
      .findByMatchIds([matchId])
  ).get(matchId);
  if (bracket?.kind !== 'year') {
    throw new Error(`Yearのブラケットのマッチではありません: ${matchId}`);
  }
  const tournament = await container
    .get<YearTournamentStore>(YEAR_TOURNAMENT_TYPES.YearTournamentStore)
    .findById(bracket.tournamentId);
  if (tournament === undefined) {
    throw new Error(`年の行がありません: ${bracket.tournamentId}`);
  }
  const progression = container.get<YearProgressionService>(
    YEAR_TOURNAMENT_TYPES.YearProgressionService,
  );
  const now = container.get<Clock>(PLATFORM_TYPES.Clock).now();
  const result = await progression.advance(tournament.yearTournamentId, now);
  if (result !== undefined) {
    await progression.applyResult(tournament, result, now);
  }
}

// eventのWeekの確定のマッチイベントの処理(WeekChampionEntryHandler)と同じく、確定の時刻から8日前以後のWeek優勝を取り込む
export async function syncChampionsByDecidedWeekMatch(
  container: Container,
  decidedAt: Date,
): Promise<void> {
  await container
    .get<YearEntryRegistrar>(YEAR_TOURNAMENT_TYPES.YearEntryRegistrar)
    .syncChampions({
      awardedFrom: new Date(decidedAt.getTime() - 8 * 86_400_000),
      now: container.get<Clock>(PLATFORM_TYPES.Clock).now(),
    });
}

// 夜の枠の送り出しの依頼を、依頼の遅延と依頼の時点の通知イベントと準備の完了の記録とともに並べる
export function eveningFlushesOf(timeline: Timeline, slotKey: string) {
  return timeline.queued
    .filter(
      ({ envelope }) =>
        envelope.type === FLUSH_NOTIFICATION_SLOT_MESSAGE.type &&
        (envelope.body as { readonly slotKey: string }).slotKey === slotKey,
    )
    .map(({ delaySeconds, snapshot }) => ({ delaySeconds, snapshot }));
}

export function slotSnapshotOf(
  slotKey: string,
): (envelope: QueueEnvelope) => Promise<SlotSnapshot | undefined> {
  return async (envelope) => {
    if (envelope.type !== FLUSH_NOTIFICATION_SLOT_MESSAGE.type) {
      return undefined;
    }
    return {
      events: await readPublishedEvents(),
      ready: await readReadyParticipants(slotKey),
    };
  };
}
