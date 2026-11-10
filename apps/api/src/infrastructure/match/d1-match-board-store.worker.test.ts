import { beforeEach, describe, expect, test } from 'vitest';

import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  insertUpvotes,
  matchIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { D1MatchBoardStore } from './d1-match-board-store.ts';
import {
  OTHER_VOTER,
  secondsAfterStart,
  seedUpvoteParticipants,
  twoSidedMatch,
  VOTER,
} from './testing/upvote-store-fixtures.ts';

const BULK_COUNT = 95;

const store = new D1MatchBoardStore(db);

beforeEach(seedUpvoteParticipants);

describe('viewerUpvotes', () => {
  test('指定したマッチのうち、閲覧者の有効なUpvoteがあるマッチだけを側のIDで返す', async () => {
    await insertMatches([1, 2, 3, 4].map((index) => twoSidedMatch(index)));
    await insertUpvotes([
      {
        index: 1,
        match: 1,
        entry: 12,
        user: VOTER,
        upvotedAt: secondsAfterStart(10),
      },
      {
        index: 2,
        match: 2,
        entry: 21,
        user: VOTER,
        upvotedAt: secondsAfterStart(20),
        columns: { deletedAt: secondsAfterStart(30) },
      },
      {
        index: 3,
        match: 3,
        entry: 31,
        user: OTHER_VOTER,
        upvotedAt: secondsAfterStart(40),
      },
      {
        index: 4,
        match: 4,
        entry: 41,
        user: VOTER,
        upvotedAt: secondsAfterStart(50),
      },
    ]);

    const found = await store.viewerUpvotes(
      [matchIdOf(1), matchIdOf(2), matchIdOf(3)],
      userIdOf(VOTER),
    );

    expect(found).toEqual(new Map([[matchIdOf(1), entryIdOf(12)]]));
  });

  test('マッチを指定しなければ問い合わせずに空で返す', async () => {
    const recording = createRecordingDatabase();

    const found = await new D1MatchBoardStore(recording.database).viewerUpvotes(
      [],
      userIdOf(VOTER),
    );

    expect(found.size).toBe(0);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('バインド変数の上限を超えるマッチの指定を分けて読む', async () => {
    const indexes = Array.from(
      { length: BULK_COUNT },
      (_, offset) => offset + 1,
    );
    await insertMatches(indexes.map((index) => twoSidedMatch(index)));
    await insertUpvotes(
      indexes.map((index) => ({
        index,
        match: index,
        entry: index * 10 + 1,
        user: VOTER,
        upvotedAt: secondsAfterStart(index),
      })),
    );
    const recording = createRecordingDatabase();

    const found = await new D1MatchBoardStore(recording.database).viewerUpvotes(
      indexes.map(matchIdOf),
      userIdOf(VOTER),
    );

    expect(found).toEqual(
      new Map(
        indexes.map((index) => [matchIdOf(index), entryIdOf(index * 10 + 1)]),
      ),
    );
    expectSplitWithinBindLimit(recording.placeholderCounts);
  });
});
