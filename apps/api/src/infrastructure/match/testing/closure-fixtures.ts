import { asc } from 'drizzle-orm';

import { matchEntries } from '../../../../db/schema/match/match-entries.ts';
import { matchUpvotes } from '../../../../db/schema/match/match-upvotes.ts';
import { matches } from '../../../../db/schema/match/matches.ts';
import { qualifierWindow } from '../../../../lib/core/match/match-model.ts';
import { parseBusinessDate } from '../../../../lib/core/time/business-time.ts';
import {
  entryIdOf,
  insertMatches,
  insertUpvotes,
  matchIdOf,
  upvoteIdOf,
} from '../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  insertProduct,
  T0,
} from '../../../../lib/workers/product/testing/product-fixtures.ts';
import {
  ENDS_AT,
  ENTRY_A,
  ENTRY_B,
  LIVE_MATCH,
  OTHER_VOTER,
  OWNER_A,
  OWNER_B,
  secondsAfterStart,
  seedUpvoteParticipants,
  STARTS_AT,
  twoSidedMatch,
  VOTER,
} from './upvote-store-fixtures.ts';

export const SAME_OWNER_MATCH = 2;

export const SCHEDULED_MATCH = 3;

export const PREVIOUS_DAY_MATCH = 4;

// 投稿者Aのプロダクト1・2の側
export const SAME_OWNER_ENTRY_1 = 21;

export const SAME_OWNER_ENTRY_2 = 22;

// 投稿者Aのプロダクト1の側と、投稿者Bのプロダクト3の側
export const SCHEDULED_ENTRY_A = 31;

export const SCHEDULED_ENTRY_B = 32;

export const PREVIOUS_DAY_ENTRY_A = 41;

export const PREVIOUS_DAY_ENTRY_B = 42;

export const LIVE_OTHER_VOTER_UPVOTE = 1;

export const LIVE_VOTER_UPVOTE = 2;

export const PREVIOUS_DAY_VOTER_UPVOTE = 3;

const PREVIOUS_DAY = '2026-11-19';

export const PREVIOUS_DAY_WINDOW = qualifierWindow(
  parseBusinessDate(PREVIOUS_DAY),
);

export const AFTER_FULL_TIME = new Date(ENDS_AT.getTime() + 60_000);

export interface MatchState {
  readonly id: string;
  readonly decidedAt: Date | null;
  readonly endedEarlyAt: Date | null;
  readonly decision: string | null;
  readonly updatedAt: Date;
}

export interface EntryState {
  readonly id: string;
  readonly upvoteCount: number;
  readonly lastUpvotedAt: Date | null;
  readonly lastUpvoteSeq: number | null;
  readonly forfeitedAt: Date | null;
  readonly result: string | null;
  readonly updatedAt: Date;
}

const INITIAL_ENTRY_STATES: Readonly<
  Record<number, Partial<EntryState> | undefined>
> = {
  [ENTRY_A]: {
    upvoteCount: 2,
    lastUpvotedAt: secondsAfterStart(30),
    lastUpvoteSeq: LIVE_VOTER_UPVOTE,
  },
  [PREVIOUS_DAY_ENTRY_A]: {
    upvoteCount: 1,
    lastUpvotedAt: PREVIOUS_DAY_WINDOW.startsAt,
    lastUpvoteSeq: PREVIOUS_DAY_VOTER_UPVOTE,
    result: 'won',
  },
  [PREVIOUS_DAY_ENTRY_B]: { result: 'lost' },
};

// 投稿者Aと投稿者Bのマッチ中のマッチ・両側が投稿者Aのマッチ中のマッチ・投稿者Aと投稿者Bの開始前のマッチと、前日の確定したマッチ。
// 利用者3はマッチ中のマッチの投稿者Aの側の最後のUpvoteと、前日のマッチの勝者の側のUpvoteを持ち、利用者4はマッチ中のマッチの投稿者Aの側の最初のUpvoteを持つ
export async function seedClosureScenario(): Promise<void> {
  await seedUpvoteParticipants();
  await insertProduct(2, OWNER_A);
  await insertMatches([
    {
      index: LIVE_MATCH,
      columns: { startedAt: STARTS_AT },
      entries: [
        {
          index: ENTRY_A,
          launch: null,
          product: 1,
          owner: OWNER_A,
          columns: {
            upvoteCount: 2,
            lastUpvotedAt: secondsAfterStart(30),
            lastUpvoteSeq: LIVE_VOTER_UPVOTE,
          },
        },
        { index: ENTRY_B, launch: null, product: 3, owner: OWNER_B },
      ],
    },
    {
      index: SAME_OWNER_MATCH,
      columns: { startedAt: STARTS_AT },
      entries: [
        { index: SAME_OWNER_ENTRY_1, launch: null, product: 1, owner: OWNER_A },
        { index: SAME_OWNER_ENTRY_2, launch: null, product: 2, owner: OWNER_A },
      ],
    },
    twoSidedMatch(SCHEDULED_MATCH, {}),
    {
      index: PREVIOUS_DAY_MATCH,
      columns: {
        matchDate: PREVIOUS_DAY,
        ...PREVIOUS_DAY_WINDOW,
        startedAt: PREVIOUS_DAY_WINDOW.startsAt,
        decidedAt: PREVIOUS_DAY_WINDOW.endsAt,
        decision: 'votes',
      },
      entries: [
        {
          index: PREVIOUS_DAY_ENTRY_A,
          launch: null,
          product: 1,
          owner: OWNER_A,
          columns: {
            upvoteCount: 1,
            lastUpvotedAt: PREVIOUS_DAY_WINDOW.startsAt,
            lastUpvoteSeq: PREVIOUS_DAY_VOTER_UPVOTE,
            result: 'won',
          },
        },
        {
          index: PREVIOUS_DAY_ENTRY_B,
          launch: null,
          product: 3,
          owner: OWNER_B,
          columns: { result: 'lost' },
        },
      ],
    },
  ]);
  await insertUpvotes([
    {
      index: LIVE_OTHER_VOTER_UPVOTE,
      match: LIVE_MATCH,
      entry: ENTRY_A,
      user: OTHER_VOTER,
      upvotedAt: secondsAfterStart(10),
    },
    {
      index: LIVE_VOTER_UPVOTE,
      match: LIVE_MATCH,
      entry: ENTRY_A,
      user: VOTER,
      upvotedAt: secondsAfterStart(30),
    },
    {
      index: PREVIOUS_DAY_VOTER_UPVOTE,
      match: PREVIOUS_DAY_MATCH,
      entry: PREVIOUS_DAY_ENTRY_A,
      user: VOTER,
      upvotedAt: PREVIOUS_DAY_WINDOW.startsAt,
      columns: { matchDate: PREVIOUS_DAY },
    },
  ]);
}

export const SCENARIO_MATCHES = [
  LIVE_MATCH,
  SAME_OWNER_MATCH,
  SCHEDULED_MATCH,
  PREVIOUS_DAY_MATCH,
] as const;

export const SCENARIO_ENTRIES = [
  ENTRY_A,
  ENTRY_B,
  SAME_OWNER_ENTRY_1,
  SAME_OWNER_ENTRY_2,
  SCHEDULED_ENTRY_A,
  SCHEDULED_ENTRY_B,
  PREVIOUS_DAY_ENTRY_A,
  PREVIOUS_DAY_ENTRY_B,
] as const;

export const SCENARIO_UPVOTES = [
  LIVE_OTHER_VOTER_UPVOTE,
  LIVE_VOTER_UPVOTE,
  PREVIOUS_DAY_VOTER_UPVOTE,
] as const;

export function matchStateOf(
  index: number,
  overrides: Partial<MatchState> = {},
): MatchState {
  const decided =
    index === PREVIOUS_DAY_MATCH
      ? { decidedAt: PREVIOUS_DAY_WINDOW.endsAt, decision: 'votes' }
      : { decidedAt: null, decision: null };
  return {
    id: matchIdOf(index),
    endedEarlyAt: null,
    updatedAt: T0,
    ...decided,
    ...overrides,
  };
}

export function entryStateOf(
  index: number,
  overrides: Partial<EntryState> = {},
): EntryState {
  return {
    id: entryIdOf(index),
    upvoteCount: 0,
    lastUpvotedAt: null,
    lastUpvoteSeq: null,
    forfeitedAt: null,
    result: null,
    updatedAt: T0,
    ...INITIAL_ENTRY_STATES[index],
    ...overrides,
  };
}

export interface UpvoteDeletion {
  readonly id: string;
  readonly deletedAt: Date | null;
}

export function upvoteDeletionOf(
  index: number,
  deletedAt: Date | null = null,
): UpvoteDeletion {
  return { id: upvoteIdOf(index), deletedAt };
}

// 変更を個別に上書きした、シナリオの全ての行の期待値。上書きの無い行は初期の値のまま
export function expectedScenario(changes: {
  readonly matches?: Readonly<Record<number, Partial<MatchState>>>;
  readonly entries?: Readonly<Record<number, Partial<EntryState>>>;
  readonly upvotes?: Readonly<Record<number, Date>>;
}) {
  return {
    matches: SCENARIO_MATCHES.map((index) =>
      matchStateOf(index, changes.matches?.[index]),
    ),
    entries: SCENARIO_ENTRIES.map((index) =>
      entryStateOf(index, changes.entries?.[index]),
    ),
    upvotes: SCENARIO_UPVOTES.map((index) =>
      upvoteDeletionOf(index, changes.upvotes?.[index] ?? null),
    ),
  };
}

export async function readScenario() {
  return {
    matches: await db
      .select({
        id: matches.id,
        decidedAt: matches.decidedAt,
        endedEarlyAt: matches.endedEarlyAt,
        decision: matches.decision,
        updatedAt: matches.updatedAt,
      })
      .from(matches)
      .orderBy(asc(matches.id)),
    entries: await db
      .select({
        id: matchEntries.id,
        upvoteCount: matchEntries.upvoteCount,
        lastUpvotedAt: matchEntries.lastUpvotedAt,
        lastUpvoteSeq: matchEntries.lastUpvoteSeq,
        forfeitedAt: matchEntries.forfeitedAt,
        result: matchEntries.result,
        updatedAt: matchEntries.updatedAt,
      })
      .from(matchEntries)
      .orderBy(asc(matchEntries.id)),
    upvotes: await db
      .select({ id: matchUpvotes.id, deletedAt: matchUpvotes.deletedAt })
      .from(matchUpvotes)
      .orderBy(asc(matchUpvotes.id)),
  };
}

// 投稿者Aが該当したときの、マッチ中の2つのマッチの即時の終了と開始前のマッチの該当の記録
export function ownerAClosure(at: Date) {
  return {
    matches: {
      [LIVE_MATCH]: {
        decidedAt: at,
        endedEarlyAt: at,
        decision: 'walkover',
        updatedAt: at,
      },
      [SAME_OWNER_MATCH]: {
        decidedAt: at,
        endedEarlyAt: at,
        decision: 'both_forfeited',
        updatedAt: at,
      },
    },
    entries: {
      [ENTRY_A]: { result: 'lost', updatedAt: at },
      [ENTRY_B]: { result: 'walkover', updatedAt: at },
      [SAME_OWNER_ENTRY_1]: { result: 'lost', updatedAt: at },
      [SAME_OWNER_ENTRY_2]: { result: 'lost', updatedAt: at },
      [SCHEDULED_ENTRY_A]: { forfeitedAt: at, updatedAt: at },
    },
  } satisfies Parameters<typeof expectedScenario>[0];
}

// 利用者3のマッチ中のマッチへのUpvoteを論理削除し、利用者4のUpvoteだけで求め直した側
export function voterLiveUpvoteRemoved(at: Date) {
  return {
    [ENTRY_A]: {
      upvoteCount: 1,
      lastUpvotedAt: secondsAfterStart(10),
      lastUpvoteSeq: LIVE_OTHER_VOTER_UPVOTE,
      updatedAt: at,
    },
  } satisfies Readonly<Record<number, Partial<EntryState>>>;
}
