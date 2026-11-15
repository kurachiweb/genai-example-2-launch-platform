import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { DECIDED_AT } from '../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  entryIdOf,
  insertMatch,
  insertUpvotes,
  matchIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import { db } from '../../../lib/workers/product/testing/product-fixtures.ts';
import { tallyRecomputeStatement } from './tally-statements.ts';
import {
  DURING_MATCH,
  ENDS_AT,
  ENTRY_A,
  ENTRY_B,
  insertLiveMatch,
  LIVE_MATCH,
  OTHER_VOTER,
  readEntries,
  secondsAfterStart,
  seedUpvoteParticipants,
  STARTS_AT,
  twoSidedMatch,
  UNVERIFIED,
  VOTER,
} from './testing/upvote-store-fixtures.ts';

const OTHER_MATCH = 2;

async function recompute(matchIndex: number, now: Date): Promise<void> {
  await db.batch([
    tallyRecomputeStatement(
      db,
      eq(matchEntries.matchId, matchIdOf(matchIndex)),
      now,
    ),
  ]);
}

beforeEach(seedUpvoteParticipants);

describe('tallyRecomputeStatement', () => {
  test('受け付け中のマッチの側の集計値を、有効なUpvoteの数と最も新しいUpvoteの日時と記録の順から求め直す', async () => {
    await insertLiveMatch();
    await insertUpvotes([
      {
        index: 1,
        match: LIVE_MATCH,
        entry: ENTRY_A,
        user: VOTER,
        upvotedAt: secondsAfterStart(10),
      },
      {
        index: 2,
        match: LIVE_MATCH,
        entry: ENTRY_A,
        user: OTHER_VOTER,
        upvotedAt: secondsAfterStart(30),
      },
      {
        index: 3,
        match: LIVE_MATCH,
        entry: ENTRY_A,
        user: UNVERIFIED,
        upvotedAt: secondsAfterStart(60),
        columns: { deletedAt: secondsAfterStart(70) },
      },
    ]);

    await recompute(LIVE_MATCH, DURING_MATCH);

    expect(await readEntries(LIVE_MATCH)).toEqual([
      {
        id: entryIdOf(ENTRY_A),
        upvoteCount: 2,
        lastUpvotedAt: secondsAfterStart(30),
        lastUpvoteSeq: 2,
        updatedAt: DURING_MATCH,
      },
      {
        id: entryIdOf(ENTRY_B),
        upvoteCount: 0,
        lastUpvotedAt: null,
        lastUpvoteSeq: null,
        updatedAt: DURING_MATCH,
      },
    ]);
  });

  test('最も新しいUpvoteの日時が同じなら、記録の順の大きいUpvoteを最終Upvoteにする', async () => {
    await insertLiveMatch();
    await insertUpvotes([
      {
        index: 5,
        match: LIVE_MATCH,
        entry: ENTRY_B,
        user: VOTER,
        upvotedAt: secondsAfterStart(40),
      },
      {
        index: 4,
        match: LIVE_MATCH,
        entry: ENTRY_B,
        user: OTHER_VOTER,
        upvotedAt: secondsAfterStart(40),
      },
    ]);

    await recompute(LIVE_MATCH, DURING_MATCH);

    const [, entryB] = await readEntries(LIVE_MATCH);
    expect(entryB).toMatchObject({
      upvoteCount: 2,
      lastUpvotedAt: secondsAfterStart(40),
      lastUpvoteSeq: 5,
    });
  });

  test('有効なUpvoteが無くなった側は0件と最終Upvoteなしに戻す', async () => {
    await insertMatch({
      ...twoSidedMatch(LIVE_MATCH),
      entries: twoSidedMatch(LIVE_MATCH).entries.map((entry) => ({
        ...entry,
        columns: {
          upvoteCount: 3,
          lastUpvotedAt: secondsAfterStart(5),
          lastUpvoteSeq: 3,
        },
      })),
    });

    await recompute(LIVE_MATCH, DURING_MATCH);

    for (const entry of await readEntries(LIVE_MATCH)) {
      expect(entry).toMatchObject({
        upvoteCount: 0,
        lastUpvotedAt: null,
        lastUpvoteSeq: null,
      });
    }
  });

  test('同じプロダクトの別のマッチのUpvoteを数えない', async () => {
    await insertLiveMatch();
    await insertMatch(twoSidedMatch(OTHER_MATCH));
    await insertUpvotes([
      {
        index: 1,
        match: OTHER_MATCH,
        entry: OTHER_MATCH * 10 + 1,
        user: VOTER,
        upvotedAt: secondsAfterStart(10),
      },
    ]);

    await recompute(LIVE_MATCH, DURING_MATCH);

    const [entryA] = await readEntries(LIVE_MATCH);
    expect(entryA).toMatchObject({ upvoteCount: 0, lastUpvotedAt: null });
  });

  test('対象の条件に当たらないマッチの側を変えない', async () => {
    await insertLiveMatch();
    await insertMatch(twoSidedMatch(OTHER_MATCH));
    await insertUpvotes([
      {
        index: 1,
        match: OTHER_MATCH,
        entry: OTHER_MATCH * 10 + 1,
        user: VOTER,
        upvotedAt: secondsAfterStart(10),
      },
    ]);
    const before = await readEntries(OTHER_MATCH);

    await recompute(LIVE_MATCH, DURING_MATCH);

    expect(await readEntries(OTHER_MATCH)).toEqual(before);
  });

  test.each([
    {
      name: '確定した',
      columns: { startedAt: STARTS_AT, decidedAt: DECIDED_AT },
      now: DURING_MATCH,
    },
    { name: '開始が記録されていない', columns: {}, now: DURING_MATCH },
    {
      name: '終了の日時を過ぎた集計中の',
      columns: { startedAt: STARTS_AT },
      now: ENDS_AT,
    },
  ])('$nameマッチの側の値を変えない', async ({ columns, now }) => {
    await insertMatch({
      ...twoSidedMatch(LIVE_MATCH, columns),
      entries: twoSidedMatch(LIVE_MATCH, columns).entries.map((entry) => ({
        ...entry,
        columns: {
          upvoteCount: 12,
          lastUpvotedAt: secondsAfterStart(5),
          lastUpvoteSeq: 20,
        },
      })),
    });
    await insertUpvotes([
      {
        index: 1,
        match: LIVE_MATCH,
        entry: ENTRY_A,
        user: VOTER,
        upvotedAt: secondsAfterStart(10),
      },
    ]);
    const before = await readEntries(LIVE_MATCH);

    await recompute(LIVE_MATCH, now);

    expect(await readEntries(LIVE_MATCH)).toEqual(before);
  });
});
