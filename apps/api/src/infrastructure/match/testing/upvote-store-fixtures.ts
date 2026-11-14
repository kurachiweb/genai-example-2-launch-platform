import { asc, eq } from 'drizzle-orm';

import { matchEntries } from '../../../../db/schema/match/match-entries.ts';
import { matchUpvotes } from '../../../../db/schema/match/match-upvotes.ts';
import { matches } from '../../../../db/schema/match/matches.ts';
import {
  DURING_MATCH,
  ENDS_AT,
  STARTS_AT,
} from '../../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  clearMatchTables,
  type EntryFixture,
  insertMatch,
  type MatchFixture,
  matchIdOf,
} from '../../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  T0,
} from '../../../../lib/workers/product/testing/product-fixtures.ts';

export { DURING_MATCH, ENDS_AT, STARTS_AT };

export const OWNER_A = 1;

export const OWNER_B = 2;

export const VOTER = 3;

export const OTHER_VOTER = 4;

export const UNVERIFIED = 5;

export const SUSPENDED = 6;

export const WITHDRAWN = 7;

export const LIVE_MATCH = 1;

// 投稿者Aのプロダクト1の側と、投稿者Bのプロダクト3の側
export const ENTRY_A = 11;

export const ENTRY_B = 12;

export const JUST_BEFORE_FULL_TIME = new Date(ENDS_AT.getTime() - 1000);

export function secondsAfterStart(seconds: number): Date {
  return new Date(STARTS_AT.getTime() + seconds * 1000);
}

// 投稿者A・B、確認済みの利用者3・4、未確認の利用者5、停止中の利用者6、退会済みの利用者7と、2人のプロダクト1・3を作る
export async function seedUpvoteParticipants(): Promise<void> {
  await clearMatchTables();
  const verified = { emailVerifiedAt: T0 };
  for (const index of [OWNER_A, OWNER_B, VOTER, OTHER_VOTER]) {
    await insertUser(index, verified);
  }
  await insertUser(UNVERIFIED);
  await insertUser(SUSPENDED, { ...verified, status: 'suspended' });
  await insertUser(WITHDRAWN, { ...verified, deletedAt: T0 });
  await insertProduct(1, OWNER_A);
  await insertProduct(3, OWNER_B);
  await insertLaunch(1, 1);
  await insertLaunch(3, 3);
}

// 予選の側のローンチは一意のため、2つ目以降のマッチの側はローンチを持たない
export function twoSidedMatch(
  index: number,
  columns: MatchFixture['columns'] = { startedAt: STARTS_AT },
  linked = false,
): MatchFixture {
  const side = (slot: 1 | 2): EntryFixture => ({
    index: index * 10 + slot,
    launch: linked ? (slot === 1 ? 1 : 3) : null,
    product: slot === 1 ? 1 : 3,
    owner: slot === 1 ? OWNER_A : OWNER_B,
  });
  return { index, columns, entries: [side(1), side(2)] };
}

export async function insertLiveMatch(): Promise<void> {
  await insertMatch(twoSidedMatch(LIVE_MATCH, { startedAt: STARTS_AT }, true));
}

export async function readEntries(matchIndex: number) {
  return db
    .select({
      id: matchEntries.id,
      upvoteCount: matchEntries.upvoteCount,
      lastUpvotedAt: matchEntries.lastUpvotedAt,
      lastUpvoteSeq: matchEntries.lastUpvoteSeq,
      updatedAt: matchEntries.updatedAt,
    })
    .from(matchEntries)
    .where(eq(matchEntries.matchId, matchIdOf(matchIndex)))
    .orderBy(asc(matchEntries.slot));
}

export async function readUpvotes(matchIndex: number) {
  return db
    .select({
      id: matchUpvotes.id,
      entryId: matchUpvotes.entryId,
      userId: matchUpvotes.userId,
      matchDate: matchUpvotes.matchDate,
      upvotedAt: matchUpvotes.upvotedAt,
      seq: matchUpvotes.seq,
      deletedAt: matchUpvotes.deletedAt,
    })
    .from(matchUpvotes)
    .where(eq(matchUpvotes.matchId, matchIdOf(matchIndex)))
    .orderBy(asc(matchUpvotes.seq), asc(matchUpvotes.id));
}

// 拒否された書き込みでどの行も変わらないことを確かめるため、マッチの3テーブルの全ての行を読む
export async function readMatchTables() {
  return {
    matches: await db.select().from(matches).orderBy(asc(matches.id)),
    entries: await db.select().from(matchEntries).orderBy(asc(matchEntries.id)),
    upvotes: await db.select().from(matchUpvotes).orderBy(asc(matchUpvotes.id)),
  };
}
