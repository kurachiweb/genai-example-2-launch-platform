import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Database } from '../../../../db/client.ts';
import { matchEntries } from '../../../../db/schema/match/match-entries.ts';
import { matchEvents } from '../../../../db/schema/match/match-events.ts';
import { matches } from '../../../../db/schema/match/matches.ts';
import { bracketMatches } from '../../../../db/schema/tournament/bracket-matches.ts';
import { bracketParticipants } from '../../../../db/schema/tournament/bracket-participants.ts';
import { tournamentBrackets } from '../../../../db/schema/tournament/tournament-brackets.ts';
import { createUlidGenerator } from '../../../core/ids/id-generator.ts';
import {
  type EntryResult,
  type MatchDecision,
  matchWindow,
} from '../../../core/match/match-model.ts';
import type {
  MatchScheduleInput,
  MatchScheduler,
} from '../../../core/match/ports.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../core/time/business-time.ts';
import { systemClock } from '../../../core/time/clock.ts';
import { dailyRoundPolicy } from '../../../core/tournament/round-schedule.ts';
import { D1MatchDirectory } from '../../match/d1-match-directory.ts';
import { D1MatchScheduler } from '../../match/d1-match-scheduler.ts';
import {
  createRecordingDispatcher,
  createSequentialIds,
  sequentialIdOf,
} from '../../match/testing/event-fixtures.ts';
import {
  db,
  insertLaunches,
  insertProducts,
  launchIdOf,
  productIdOf,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';
import { D1BracketProgression } from '../d1-bracket-progression.ts';
import { D1BracketStore } from '../d1-bracket-store.ts';
import {
  bracketIdOf,
  insertBracketMatches,
  insertBrackets,
  insertParticipants,
} from './bracket-fixtures.ts';

export const BRACKET_ID = bracketIdOf(1);

export const FIRST_ROUND_DATE = parseBusinessDate('2026-11-24');

export const SECOND_ROUND_DATE = parseBusinessDate('2026-11-25');

export const LATE_SECOND_ROUND_DATE = parseBusinessDate('2026-11-26');

export function at(date: string, hour: number, minute: number): Date {
  return fromBusinessDateTime(parseBusinessDate(date), { hour, minute });
}

// 月曜日23:45の組み合わせ決定
export const DRAW_AT = at('2026-11-23', 23, 45);

export const FIRST_ROUND_DECIDED_AT = at('2026-11-24', 23, 40);

export const FIRST_ROUND_ADVANCE_AT = at('2026-11-24', 23, 45);

export const POLICY = dailyRoundPolicy(FIRST_ROUND_DATE, DRAW_AT);

export const FIRST_ROUND_IDS = 1;

export interface RecordingScheduler extends MatchScheduler {
  readonly sizes: number[];
}

function recordingScheduler(inner: MatchScheduler): RecordingScheduler {
  const sizes: number[] = [];
  return {
    sizes,
    schedule(inputs, scheduledAt) {
      sizes.push(inputs.length);
      return inner.schedule(inputs, scheduledAt);
    },
  };
}

export function createProgression(
  idStart: number,
  database: Database = db,
): { progression: D1BracketProgression; scheduler: RecordingScheduler } {
  const scheduler = recordingScheduler(
    new D1MatchScheduler(
      database,
      createRecordingDispatcher(),
      createUlidGenerator(systemClock),
    ),
  );
  return {
    scheduler,
    progression: new D1BracketProgression(
      database,
      createSequentialIds(idStart),
      new D1BracketStore(database),
      new D1MatchDirectory(database),
      scheduler,
      'api',
    ),
  };
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

// 利用者1のプロダクトとローンチ1〜Nを、同じ番号の抽選番号の参加者にする
export async function seedBracket(
  participantCount: number,
  kind: 'week' | 'year' = 'week',
): Promise<void> {
  const indexes = range(participantCount);
  await insertProducts(indexes, 1);
  await insertLaunches(
    indexes.map((index) => ({ index, productIndex: index })),
  );
  await insertBrackets([
    {
      index: 1,
      kind,
      participantCount,
      columns: { firstRoundDate: FIRST_ROUND_DATE },
    },
  ]);
  await insertParticipants(
    indexes.map((index) => ({
      index,
      bracket: 1,
      participantNo: index,
      entry: index,
      launch: index,
      product: index,
      owner: 1,
    })),
  );
}

export async function settle(
  matchId: string,
  results: readonly EntryResult[],
  decision: MatchDecision = 'votes',
): Promise<void> {
  await db
    .update(matches)
    .set({
      startedAt: matchWindow(FIRST_ROUND_DATE).startsAt,
      decidedAt: FIRST_ROUND_DECIDED_AT,
      decision,
    })
    .where(eq(matches.id, matchId));
  for (const [index, result] of results.entries()) {
    await db
      .update(matchEntries)
      .set({ result })
      .where(
        and(
          eq(matchEntries.matchId, matchId),
          eq(matchEntries.slot, index + 1),
        ),
      );
  }
}

export async function readBracketMatches(round?: number) {
  return db
    .select({
      matchId: bracketMatches.matchId,
      round: bracketMatches.round,
      position: bracketMatches.position,
      matchDate: bracketMatches.matchDate,
      participant1No: bracketMatches.participant1No,
      participant2No: bracketMatches.participant2No,
      status: bracketMatches.status,
      winnerParticipantNo: bracketMatches.winnerParticipantNo,
      decidedAt: bracketMatches.decidedAt,
    })
    .from(bracketMatches)
    .where(
      round === undefined
        ? eq(bracketMatches.bracketId, BRACKET_ID)
        : and(
            eq(bracketMatches.bracketId, BRACKET_ID),
            eq(bracketMatches.round, round),
          ),
    )
    .orderBy(asc(bracketMatches.round), asc(bracketMatches.position));
}

export async function readEliminated() {
  const rows = await db
    .select({
      participantNo: bracketParticipants.participantNo,
      eliminatedRound: bracketParticipants.eliminatedRound,
    })
    .from(bracketParticipants)
    .orderBy(asc(bracketParticipants.participantNo));
  return new Map(
    rows.map(({ participantNo, eliminatedRound }) => [
      participantNo,
      eliminatedRound,
    ]),
  );
}

export async function readMatchesOfRound(round: number) {
  return db
    .select({
      id: matches.id,
      kind: matches.kind,
      round: matches.round,
      stage: matches.stage,
      matchDate: matches.matchDate,
      startsAt: matches.startsAt,
      endsAt: matches.endsAt,
    })
    .from(matches)
    .where(eq(matches.round, round))
    .orderBy(asc(matches.id));
}

export async function readEntriesOf(matchId: string) {
  return db
    .select({
      slot: matchEntries.slot,
      launchId: matchEntries.launchId,
      productId: matchEntries.productId,
      ownerUserId: matchEntries.ownerUserId,
    })
    .from(matchEntries)
    .where(eq(matchEntries.matchId, matchId))
    .orderBy(asc(matchEntries.slot));
}

export async function readScheduledEventMatchIds(): Promise<string[]> {
  const rows = await db
    .select({ matchId: matchEvents.matchId })
    .from(matchEvents)
    .where(eq(matchEvents.type, 'scheduled'))
    .orderBy(asc(matchEvents.matchId));
  return rows.map(({ matchId }) => matchId);
}

export function windowOf(date: BusinessDate) {
  return matchWindow(date);
}

export const R1_POSITION_1 = sequentialIdOf(FIRST_ROUND_IDS);
export const R1_POSITION_2 = sequentialIdOf(FIRST_ROUND_IDS + 1);

// 参加6(シード1・2、1回戦は3×4と5×6)の1回戦を予定する
export async function scheduleFirstRoundOfSix(): Promise<void> {
  await seedBracket(6);
  await createProgression(FIRST_ROUND_IDS).progression.advance(
    BRACKET_ID,
    POLICY,
    DRAW_AT,
  );
}

export const PROGRESSION_CATEGORY = 'api.tournament.progression';

export const AFTER_MIDNIGHT = at('2026-11-25', 0, 10);

export async function unlink(participantNos: readonly number[]): Promise<void> {
  await db
    .update(bracketParticipants)
    .set({ launchId: null, productId: null, ownerUserId: null })
    .where(
      and(
        eq(bracketParticipants.bracketId, BRACKET_ID),
        inArray(bracketParticipants.participantNo, [...participantNos]),
      ),
    );
}

export async function readBracket() {
  const [row] = await db
    .select({
      status: tournamentBrackets.status,
      outcome: tournamentBrackets.outcome,
      championParticipantNo: tournamentBrackets.championParticipantNo,
      finishedAt: tournamentBrackets.finishedAt,
    })
    .from(tournamentBrackets)
    .where(eq(tournamentBrackets.id, BRACKET_ID));
  return row;
}

export interface PlannedFixture {
  readonly index: number;
  readonly position: number;
  readonly participantNos: readonly [number] | readonly [number, number];
}

// 位置を挿入した後、マッチの予定を作る前に中断した状態を作る
export async function insertPlannedRound(
  round: number,
  matchDate: BusinessDate,
  fixtures: readonly PlannedFixture[],
): Promise<void> {
  await insertBracketMatches(
    fixtures.map(({ index, position, participantNos }) => ({
      index,
      bracket: 1,
      round,
      position,
      participantNos,
      columns: { status: 'planned', matchDate },
    })),
  );
}

export function scheduleInputOf(
  matchId: string,
  round: number,
  matchDate: BusinessDate,
  participantNos: readonly number[],
): MatchScheduleInput {
  const window = windowOf(matchDate);
  const [first, second] = participantNos.map((index) => ({
    launchId: launchIdOf(index),
    productId: productIdOf(index),
    ownerUserId: userIdOf(1),
  }));
  if (first === undefined) {
    throw new Error('側がありません');
  }
  return {
    matchId,
    kind: 'week',
    round,
    stage: null,
    matchDate,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    entries: second === undefined ? [first] : [first, second],
  };
}
