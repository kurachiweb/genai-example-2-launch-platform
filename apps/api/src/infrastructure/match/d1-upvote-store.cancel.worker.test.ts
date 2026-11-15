import { beforeEach, describe, expect, test } from 'vitest';

import { DECIDED_AT } from '../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  insertMatch,
  insertUpvotes,
  matchIdOf,
  upvoteIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { D1UpvoteStore } from './d1-upvote-store.ts';
import {
  DURING_MATCH,
  ENDS_AT,
  ENTRY_A,
  insertLiveMatch,
  JUST_BEFORE_FULL_TIME,
  LIVE_MATCH,
  OTHER_VOTER,
  readEntries,
  readMatchTables,
  readUpvotes,
  secondsAfterStart,
  seedUpvoteParticipants,
  STARTS_AT,
  twoSidedMatch,
  VOTER,
} from './testing/upvote-store-fixtures.ts';

const store = new D1UpvoteStore(db);

const matchId = matchIdOf(LIVE_MATCH);

const userId = userIdOf(VOTER);

async function seedTwoUpvotesOnA(): Promise<void> {
  await insertUpvotes([
    {
      index: 1,
      match: LIVE_MATCH,
      entry: ENTRY_A,
      user: OTHER_VOTER,
      upvotedAt: secondsAfterStart(10),
    },
    {
      index: 2,
      match: LIVE_MATCH,
      entry: ENTRY_A,
      user: VOTER,
      upvotedAt: secondsAfterStart(20),
    },
  ]);
}

beforeEach(seedUpvoteParticipants);

describe('cancel', () => {
  test('有効なUpvoteを物理削除し、残りの有効なUpvoteから集計値を求め直す', async () => {
    await insertLiveMatch();
    await seedTwoUpvotesOnA();

    const result = await store.cancel({ matchId, userId, now: DURING_MATCH });

    expect(result).toBe('cancelled');
    expect(await readUpvotes(LIVE_MATCH)).toEqual([
      expect.objectContaining({ id: upvoteIdOf(1) }),
    ]);
    const [entryA] = await readEntries(LIVE_MATCH);
    expect(entryA).toMatchObject({
      upvoteCount: 1,
      lastUpvotedAt: secondsAfterStart(10),
      lastUpvoteSeq: 1,
      updatedAt: DURING_MATCH,
    });
  });

  test('有効なUpvoteが無ければnothingを返し、論理削除されたUpvoteを消さない', async () => {
    await insertLiveMatch();
    await insertUpvotes([
      {
        index: 1,
        match: LIVE_MATCH,
        entry: ENTRY_A,
        user: VOTER,
        upvotedAt: secondsAfterStart(10),
        columns: { deletedAt: secondsAfterStart(20) },
      },
    ]);
    const before = await readUpvotes(LIVE_MATCH);

    const result = await store.cancel({ matchId, userId, now: DURING_MATCH });

    expect(result).toBe('nothing');
    expect(await readUpvotes(LIVE_MATCH)).toEqual(before);
    expect(
      (await readEntries(LIVE_MATCH)).map((entry) => entry.upvoteCount),
    ).toEqual([0, 0]);
  });

  test('23:39:59に読み取った後、時計が23:40へ進んだ要求の取り消しはnothingを返し、どの行も変えない', async () => {
    await insertLiveMatch();
    await seedTwoUpvotesOnA();
    expect(
      (await store.findState(matchId, userId, JUST_BEFORE_FULL_TIME))?.phase,
    ).toBe('live');
    const before = await readMatchTables();

    const result = await store.cancel({ matchId, userId, now: ENDS_AT });

    expect(result).toBe('nothing');
    expect(await readMatchTables()).toEqual(before);
  });

  test.each([
    { name: '開始が記録されていない', columns: {} },
    {
      name: '確定した',
      columns: { startedAt: STARTS_AT, decidedAt: DECIDED_AT },
    },
  ])(
    '$nameマッチの取り消しはnothingを返し、どの行も変えない',
    async ({ columns }) => {
      await insertMatch(twoSidedMatch(LIVE_MATCH, columns, true));
      await seedTwoUpvotesOnA();
      const before = await readMatchTables();

      const result = await store.cancel({ matchId, userId, now: DURING_MATCH });

      expect(result).toBe('nothing');
      expect(await readMatchTables()).toEqual(before);
    },
  );
});
