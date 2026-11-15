import { beforeEach, describe, expect, test } from 'vitest';

import type { UpvoteAction } from '../../domain/match/upvote-plan.ts';
import { DECIDED_AT } from '../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  entryIdOf,
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
  ENTRY_B,
  insertLiveMatch,
  JUST_BEFORE_FULL_TIME,
  LIVE_MATCH,
  OWNER_A,
  OWNER_B,
  readMatchTables,
  secondsAfterStart,
  seedUpvoteParticipants,
  STARTS_AT,
  SUSPENDED,
  twoSidedMatch,
  UNVERIFIED,
  VOTER,
  WITHDRAWN,
} from './testing/upvote-store-fixtures.ts';

const store = new D1UpvoteStore(db);

const matchId = matchIdOf(LIVE_MATCH);

const insertA: Exclude<UpvoteAction, { kind: 'none' }> = {
  kind: 'insert',
  entryId: entryIdOf(ENTRY_A),
};

async function expectRejectedWithoutChanges(input: {
  readonly action?: Exclude<UpvoteAction, { kind: 'none' }>;
  readonly matchId?: string;
  readonly user?: number;
  readonly now?: Date;
}): Promise<void> {
  const before = await readMatchTables();

  const result = await store.apply({
    action: input.action ?? insertA,
    matchId: input.matchId ?? matchId,
    userId: userIdOf(input.user ?? VOTER),
    upvoteId: upvoteIdOf(100),
    now: input.now ?? DURING_MATCH,
  });

  expect(result).toBe('rejected');
  expect(await readMatchTables()).toEqual(before);
}

beforeEach(seedUpvoteParticipants);

describe('apply の記録の時点の条件', () => {
  test.each([
    { name: '開始が記録されていないマッチ', columns: {} },
    {
      name: '確定したマッチ',
      columns: { startedAt: STARTS_AT, decidedAt: DECIDED_AT },
    },
  ])('$nameへの追加を拒否する', async ({ columns }) => {
    await insertMatch(twoSidedMatch(LIVE_MATCH, columns, true));

    await expectRejectedWithoutChanges({});
  });

  test('23:39:59に読み取った後、時計が23:40へ進んだ要求の追加を拒否する', async () => {
    await insertLiveMatch();
    const state = await store.findState(
      matchId,
      userIdOf(VOTER),
      JUST_BEFORE_FULL_TIME,
    );
    expect(state?.phase).toBe('live');

    await expectRejectedWithoutChanges({ now: ENDS_AT });
  });

  test('時計が23:40へ進んだ要求の付け替えを拒否し、以前のUpvoteを残す', async () => {
    await insertLiveMatch();
    await insertUpvotes([
      {
        index: 1,
        match: LIVE_MATCH,
        entry: ENTRY_A,
        user: VOTER,
        upvotedAt: secondsAfterStart(10),
      },
    ]);

    await expectRejectedWithoutChanges({
      action: {
        kind: 'switch',
        fromEntryId: entryIdOf(ENTRY_A),
        toEntryId: entryIdOf(ENTRY_B),
      },
      now: ENDS_AT,
    });
  });

  test.each([
    { name: '自分のプロダクトの側', user: OWNER_A },
    { name: '自分のプロダクトの対戦相手の側', user: OWNER_B },
  ])('$nameへの追加を拒否する', async ({ user }) => {
    await insertLiveMatch();

    await expectRejectedWithoutChanges({ user });
  });

  test.each([
    { name: 'メールアドレスが未確認', user: UNVERIFIED },
    { name: '停止中', user: SUSPENDED },
    { name: '退会済み', user: WITHDRAWN },
  ])('$nameの利用者の追加を拒否する', async ({ user }) => {
    await insertLiveMatch();

    await expectRejectedWithoutChanges({ user });
  });

  test('マッチに無い側への追加を拒否する', async () => {
    await insertLiveMatch();
    await insertMatch(twoSidedMatch(2));

    await expectRejectedWithoutChanges({
      action: { kind: 'insert', entryId: entryIdOf(21) },
    });
  });

  test('存在しないマッチへの追加を拒否する', async () => {
    await insertLiveMatch();

    await expectRejectedWithoutChanges({ matchId: matchIdOf(99) });
  });
});
