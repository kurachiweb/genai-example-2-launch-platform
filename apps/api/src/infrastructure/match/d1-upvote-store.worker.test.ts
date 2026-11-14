import { beforeEach, describe, expect, test } from 'vitest';

import { DECIDED_AT } from '../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  entryIdOf,
  insertMatch,
  insertUpvotes,
  MATCH_DATE,
  matchIdOf,
  upvoteIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import type { UpvoteState } from '../../application/match/ports.ts';
import { D1UpvoteStore } from './d1-upvote-store.ts';
import {
  DURING_MATCH,
  ENDS_AT,
  ENTRY_A,
  ENTRY_B,
  insertLiveMatch,
  JUST_BEFORE_FULL_TIME,
  LIVE_MATCH,
  OTHER_VOTER,
  OWNER_A,
  OWNER_B,
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

beforeEach(seedUpvoteParticipants);

describe('findState', () => {
  test('マッチの状態・側の番号の順の側と投稿者・利用者の有効なUpvoteの側を返す', async () => {
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
      {
        index: 2,
        match: LIVE_MATCH,
        entry: ENTRY_B,
        user: VOTER,
        upvotedAt: secondsAfterStart(30),
      },
      {
        index: 3,
        match: LIVE_MATCH,
        entry: ENTRY_A,
        user: OTHER_VOTER,
        upvotedAt: secondsAfterStart(40),
      },
    ]);

    expect(
      await store.findState(matchId, userId, DURING_MATCH),
    ).toEqual<UpvoteState>({
      matchId,
      phase: 'live',
      entryIds: [entryIdOf(ENTRY_A), entryIdOf(ENTRY_B)],
      ownerUserIds: [userIdOf(OWNER_A), userIdOf(OWNER_B)],
      currentEntryId: entryIdOf(ENTRY_B),
    });
  });

  test('有効なUpvoteが無ければ側をnullで返し、紐付けを解除した側の投稿者はnullで返す', async () => {
    await insertMatch({
      index: LIVE_MATCH,
      columns: { startedAt: STARTS_AT },
      entries: [
        { index: ENTRY_A, launch: null, product: null, owner: null },
        { index: ENTRY_B, launch: null, product: 3, owner: OWNER_B },
      ],
    });

    expect(await store.findState(matchId, userId, DURING_MATCH)).toMatchObject({
      ownerUserIds: [null, userIdOf(OWNER_B)],
      currentEntryId: null,
    });
  });

  test.each([
    {
      name: '開始の記録の前は予定',
      columns: {},
      now: DURING_MATCH,
      phase: 'scheduled',
    },
    {
      name: '23:39:59はマッチ中',
      columns: { startedAt: STARTS_AT },
      now: JUST_BEFORE_FULL_TIME,
      phase: 'live',
    },
    {
      name: '23:40は集計中',
      columns: { startedAt: STARTS_AT },
      now: ENDS_AT,
      phase: 'tallying',
    },
    {
      name: '確定の後は終了',
      columns: { startedAt: STARTS_AT, decidedAt: DECIDED_AT },
      now: DURING_MATCH,
      phase: 'finished',
    },
  ] as const)('$name', async ({ columns, now, phase }) => {
    await insertMatch(twoSidedMatch(LIVE_MATCH, columns));

    expect((await store.findState(matchId, userId, now))?.phase).toBe(phase);
  });

  test('マッチが無ければundefinedを返す', async () => {
    expect(
      await store.findState(matchIdOf(99), userId, DURING_MATCH),
    ).toBeUndefined();
  });
});

describe('apply', () => {
  beforeEach(insertLiveMatch);

  test('追加は、マッチ内の記録の順の次の値でUpvoteを記録し、側の集計値を求め直す', async () => {
    await insertUpvotes([
      {
        index: 7,
        match: LIVE_MATCH,
        entry: ENTRY_B,
        user: OTHER_VOTER,
        upvotedAt: secondsAfterStart(10),
      },
    ]);

    const result = await store.apply({
      action: { kind: 'insert', entryId: entryIdOf(ENTRY_A) },
      matchId,
      userId,
      upvoteId: upvoteIdOf(100),
      now: DURING_MATCH,
    });

    expect(result).toBe('applied');
    expect(await readUpvotes(LIVE_MATCH)).toEqual([
      expect.objectContaining({ id: upvoteIdOf(7), seq: 7 }),
      {
        id: upvoteIdOf(100),
        entryId: entryIdOf(ENTRY_A),
        userId,
        matchDate: MATCH_DATE,
        upvotedAt: DURING_MATCH,
        seq: 8,
        deletedAt: null,
      },
    ]);
    expect(await readEntries(LIVE_MATCH)).toEqual([
      expect.objectContaining({
        upvoteCount: 1,
        lastUpvotedAt: DURING_MATCH,
        lastUpvoteSeq: 8,
      }),
      expect.objectContaining({
        upvoteCount: 1,
        lastUpvotedAt: secondsAfterStart(10),
        lastUpvoteSeq: 7,
      }),
    ]);
  });

  test('付け替えは、以前のUpvoteを物理削除して新しい側に記録し、両側の集計値を求め直す', async () => {
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

    const result = await store.apply({
      action: {
        kind: 'switch',
        fromEntryId: entryIdOf(ENTRY_A),
        toEntryId: entryIdOf(ENTRY_B),
      },
      matchId,
      userId,
      upvoteId: upvoteIdOf(100),
      now: DURING_MATCH,
    });

    expect(result).toBe('applied');
    expect(await readUpvotes(LIVE_MATCH)).toEqual([
      expect.objectContaining({ id: upvoteIdOf(1) }),
      expect.objectContaining({
        id: upvoteIdOf(100),
        entryId: entryIdOf(ENTRY_B),
        seq: 2,
      }),
    ]);
    expect(await readEntries(LIVE_MATCH)).toEqual([
      expect.objectContaining({
        upvoteCount: 1,
        lastUpvotedAt: secondsAfterStart(10),
        lastUpvoteSeq: 1,
      }),
      expect.objectContaining({
        upvoteCount: 1,
        lastUpvotedAt: DURING_MATCH,
        lastUpvoteSeq: 2,
      }),
    ]);
  });

  test('付け替えの前の状態から決めた2つ目の同じ付け替えはduplicateを返し、付け替えたUpvoteと集計値を変えない', async () => {
    await insertUpvotes([
      {
        index: 1,
        match: LIVE_MATCH,
        entry: ENTRY_A,
        user: VOTER,
        upvotedAt: secondsAfterStart(20),
      },
    ]);
    const switchToB = (upvoteId: string, now: Date) =>
      store.apply({
        action: {
          kind: 'switch',
          fromEntryId: entryIdOf(ENTRY_A),
          toEntryId: entryIdOf(ENTRY_B),
        },
        matchId,
        userId,
        upvoteId,
        now,
      });
    expect(await switchToB(upvoteIdOf(100), DURING_MATCH)).toBe('applied');
    const afterFirst = await readMatchTables();

    const result = await switchToB(
      upvoteIdOf(101),
      new Date(DURING_MATCH.getTime() + 60_000),
    );

    expect(result).toBe('duplicate');
    expect(await readMatchTables()).toEqual(afterFirst);
  });

  test('既に有効なUpvoteがある利用者の追加はduplicateを返し、どの行も変えない', async () => {
    await insertUpvotes([
      {
        index: 1,
        match: LIVE_MATCH,
        entry: ENTRY_A,
        user: VOTER,
        upvotedAt: secondsAfterStart(10),
      },
    ]);
    const before = await readMatchTables();

    const result = await store.apply({
      action: { kind: 'insert', entryId: entryIdOf(ENTRY_A) },
      matchId,
      userId,
      upvoteId: upvoteIdOf(100),
      now: DURING_MATCH,
    });

    expect(result).toBe('duplicate');
    expect(await readMatchTables()).toEqual(before);
  });

  test('同じ利用者の同時の2つの追加では1つだけが残り、集計値が記録と一致する', async () => {
    const results = await Promise.all(
      [ENTRY_A, ENTRY_B].map((entry, offset) =>
        store.apply({
          action: { kind: 'insert', entryId: entryIdOf(entry) },
          matchId,
          userId,
          upvoteId: upvoteIdOf(100 + offset),
          now: DURING_MATCH,
        }),
      ),
    );

    expect([...results].sort()).toEqual(['applied', 'duplicate']);
    const upvotes = await readUpvotes(LIVE_MATCH);
    expect(upvotes).toHaveLength(1);
    const counts = (await readEntries(LIVE_MATCH)).map(
      ({ id, upvoteCount }) => [id, upvoteCount],
    );
    expect(counts).toEqual(
      [entryIdOf(ENTRY_A), entryIdOf(ENTRY_B)].map((id) => [
        id,
        upvotes[0]?.entryId === id ? 1 : 0,
      ]),
    );
  });

  test('論理削除されたUpvoteしか無い利用者は再びUpvoteでき、論理削除されたUpvoteは数えない', async () => {
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

    const result = await store.apply({
      action: { kind: 'insert', entryId: entryIdOf(ENTRY_A) },
      matchId,
      userId,
      upvoteId: upvoteIdOf(100),
      now: DURING_MATCH,
    });

    expect(result).toBe('applied');
    expect(await readUpvotes(LIVE_MATCH)).toEqual([
      expect.objectContaining({
        id: upvoteIdOf(1),
        deletedAt: secondsAfterStart(20),
      }),
      expect.objectContaining({ id: upvoteIdOf(100), seq: 2, deletedAt: null }),
    ]);
    const [entryA] = await readEntries(LIVE_MATCH);
    expect(entryA).toMatchObject({ upvoteCount: 1, lastUpvoteSeq: 2 });
  });

  test('取り消しの後は再びUpvoteできる', async () => {
    await store.apply({
      action: { kind: 'insert', entryId: entryIdOf(ENTRY_A) },
      matchId,
      userId,
      upvoteId: upvoteIdOf(100),
      now: DURING_MATCH,
    });
    await store.cancel({ matchId, userId, now: DURING_MATCH });

    const result = await store.apply({
      action: { kind: 'insert', entryId: entryIdOf(ENTRY_B) },
      matchId,
      userId,
      upvoteId: upvoteIdOf(101),
      now: DURING_MATCH,
    });

    expect(result).toBe('applied');
    expect(await readUpvotes(LIVE_MATCH)).toEqual([
      expect.objectContaining({
        id: upvoteIdOf(101),
        entryId: entryIdOf(ENTRY_B),
      }),
    ]);
    expect(
      (await readEntries(LIVE_MATCH)).map((entry) => entry.upvoteCount),
    ).toEqual([0, 1]);
  });
});
