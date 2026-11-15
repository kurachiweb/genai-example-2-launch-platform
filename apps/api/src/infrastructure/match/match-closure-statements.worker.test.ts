import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import { matchEntries } from '../../../db/schema/match/match-entries.ts';
import { matches } from '../../../db/schema/match/matches.ts';
import {
  entryIdOf,
  matchIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  productIdOf,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import {
  matchClosureStatements,
  type MatchClosureInput,
} from './match-closure-statements.ts';
import {
  AFTER_FULL_TIME,
  expectedScenario,
  LIVE_VOTER_UPVOTE,
  PREVIOUS_DAY_VOTER_UPVOTE,
  readScenario,
  ownerAClosure,
  SAME_OWNER_ENTRY_2,
  SAME_OWNER_MATCH,
  SCHEDULED_ENTRY_A,
  seedClosureScenario,
  voterLiveUpvoteRemoved,
} from './testing/closure-fixtures.ts';
import {
  DURING_MATCH,
  ENDS_AT,
  ENTRY_A,
  ENTRY_B,
  JUST_BEFORE_FULL_TIME,
  LIVE_MATCH,
  OWNER_A,
  VOTER,
} from './testing/upvote-store-fixtures.ts';

async function commit(input: MatchClosureInput): Promise<void> {
  const [first, ...rest]: readonly BatchItem<'sqlite'>[] =
    matchClosureStatements(db, input);
  if (first === undefined) {
    throw new Error('文が返されませんでした');
  }
  await db.batch([first, ...rest]);
}

function closeUser(
  userIndex: number,
  upvotes: 'all' | 'live' | 'none',
  at: Date,
): Promise<void> {
  return commit({
    subject: { kind: 'user', userId: userIdOf(userIndex) },
    upvotes,
    at,
  });
}

// 23:40の確定が先に書いたマッチ中のマッチ
async function settleLiveMatchFirst(): Promise<void> {
  await db.batch([
    db
      .update(matchEntries)
      .set({ result: 'won', updatedAt: ENDS_AT })
      .where(eq(matchEntries.id, entryIdOf(ENTRY_A))),
    db
      .update(matchEntries)
      .set({ result: 'lost', updatedAt: ENDS_AT })
      .where(eq(matchEntries.id, entryIdOf(ENTRY_B))),
    db
      .update(matches)
      .set({ decidedAt: ENDS_AT, decision: 'votes', updatedAt: ENDS_AT })
      .where(eq(matches.id, matchIdOf(LIVE_MATCH))),
  ]);
}

const LIVE_SETTLED_FIRST = {
  matches: {
    [LIVE_MATCH]: { decidedAt: ENDS_AT, decision: 'votes', updatedAt: ENDS_AT },
  },
  entries: {
    [ENTRY_A]: { result: 'won', updatedAt: ENDS_AT },
    [ENTRY_B]: { result: 'lost', updatedAt: ENDS_AT },
  },
};

beforeEach(seedClosureScenario);

describe('matchClosureStatements', () => {
  test('利用者を対象にするとSystem Flowsの1〜5の5文、プロダクトを対象にすると3〜5の3文を返し、返すだけでは書き込まない', async () => {
    const before = await readScenario();

    expect(
      matchClosureStatements(db, {
        subject: { kind: 'user', userId: userIdOf(OWNER_A) },
        upvotes: 'all',
        at: DURING_MATCH,
      }),
    ).toHaveLength(5);
    expect(
      matchClosureStatements(db, {
        subject: { kind: 'product', productId: productIdOf(1) },
        upvotes: 'none',
        at: DURING_MATCH,
      }),
    ).toHaveLength(3);
    expect(
      matchClosureStatements(db, {
        subject: { kind: 'user', userId: userIdOf(OWNER_A) },
        upvotes: 'none',
        at: DURING_MATCH,
      }),
    ).toHaveLength(3);
    await expect(readScenario()).resolves.toEqual(before);
  });

  describe('投稿者の即時の終了と該当の記録', () => {
    test('投稿者のマッチ中のマッチをその時点の値のまま即時に終了し、相手の側を相手の退会等による勝利・該当した側を敗北にし、両側が同じ投稿者なら両方を敗北にし、開始前のマッチの側に該当を記録する', async () => {
      await closeUser(OWNER_A, 'live', DURING_MATCH);

      await expect(readScenario()).resolves.toEqual(
        expectedScenario(ownerAClosure(DURING_MATCH)),
      );
    });

    test('プロダクトを対象にすると、そのプロダクトの側だけを該当にし、同じ投稿者の別のプロダクトの側は相手の退会等による勝利にし、Upvoteを変えない', async () => {
      await commit({
        subject: { kind: 'product', productId: productIdOf(1) },
        upvotes: 'none',
        at: DURING_MATCH,
      });

      const closed = ownerAClosure(DURING_MATCH);
      await expect(readScenario()).resolves.toEqual(
        expectedScenario({
          matches: {
            ...closed.matches,
            [SAME_OWNER_MATCH]: {
              ...closed.matches[SAME_OWNER_MATCH],
              decision: 'walkover',
            },
          },
          entries: {
            ...closed.entries,
            [SAME_OWNER_ENTRY_2]: {
              result: 'walkover',
              updatedAt: DURING_MATCH,
            },
          },
        }),
      );
    });

    test('集計中(終了の日時以降で未確定)のマッチは即時に終了せず確定のジョブに任せ、開始前のマッチの側の該当だけを記録する', async () => {
      await closeUser(OWNER_A, 'live', AFTER_FULL_TIME);

      await expect(readScenario()).resolves.toEqual(
        expectedScenario({
          entries: {
            [SCHEDULED_ENTRY_A]: {
              forfeitedAt: AFTER_FULL_TIME,
              updatedAt: AFTER_FULL_TIME,
            },
          },
        }),
      );
    });

    test('23:40の確定が先にdecided_atを書いたマッチは、終了の日時の前の時刻の文でも側の結果と決着を変えない', async () => {
      await settleLiveMatchFirst();

      await closeUser(OWNER_A, 'live', JUST_BEFORE_FULL_TIME);

      const closed = ownerAClosure(JUST_BEFORE_FULL_TIME);
      await expect(readScenario()).resolves.toEqual(
        expectedScenario({
          matches: {
            ...LIVE_SETTLED_FIRST.matches,
            [SAME_OWNER_MATCH]: closed.matches[SAME_OWNER_MATCH],
          },
          entries: {
            ...closed.entries,
            ...LIVE_SETTLED_FIRST.entries,
          },
        }),
      );
    });

    test('既に即時に終了したマッチと該当を記録した側は、後の退会の文で日時と決着を書き換えない', async () => {
      const later = new Date(DURING_MATCH.getTime() + 60_000);
      await closeUser(OWNER_A, 'live', DURING_MATCH);

      await closeUser(OWNER_A, 'all', later);

      await expect(readScenario()).resolves.toEqual(
        expectedScenario(ownerAClosure(DURING_MATCH)),
      );
    });
  });

  describe('投票者のUpvoteの論理削除と集計値の求め直し', () => {
    test('liveでは、マッチ中のマッチへのUpvoteだけを論理削除し、その側の集計値を残りの有効なUpvoteから求め直し、確定したマッチのUpvoteと確定値を変えない', async () => {
      await closeUser(VOTER, 'live', DURING_MATCH);

      await expect(readScenario()).resolves.toEqual(
        expectedScenario({
          entries: voterLiveUpvoteRemoved(DURING_MATCH),
          upvotes: { [LIVE_VOTER_UPVOTE]: DURING_MATCH },
        }),
      );
    });

    test('allでは、確定したマッチを含む全ての有効なUpvoteを論理削除し、マッチ中のマッチの側だけを求め直し、確定したマッチの確定値を変えない', async () => {
      await closeUser(VOTER, 'all', DURING_MATCH);

      await expect(readScenario()).resolves.toEqual(
        expectedScenario({
          entries: voterLiveUpvoteRemoved(DURING_MATCH),
          upvotes: {
            [LIVE_VOTER_UPVOTE]: DURING_MATCH,
            [PREVIOUS_DAY_VOTER_UPVOTE]: DURING_MATCH,
          },
        }),
      );
    });

    test('集計中のマッチでは、liveはUpvoteを論理削除せず、allは論理削除しても側の集計値を求め直さない', async () => {
      await closeUser(VOTER, 'live', AFTER_FULL_TIME);

      await expect(readScenario()).resolves.toEqual(expectedScenario({}));

      await closeUser(VOTER, 'all', AFTER_FULL_TIME);

      await expect(readScenario()).resolves.toEqual(
        expectedScenario({
          upvotes: {
            [LIVE_VOTER_UPVOTE]: AFTER_FULL_TIME,
            [PREVIOUS_DAY_VOTER_UPVOTE]: AFTER_FULL_TIME,
          },
        }),
      );
    });

    test('23:40の確定が先に書いたマッチでは、終了の日時の前の時刻の退会の文でも側の確定値を変えない', async () => {
      await settleLiveMatchFirst();

      await closeUser(VOTER, 'all', JUST_BEFORE_FULL_TIME);

      await expect(readScenario()).resolves.toEqual(
        expectedScenario({
          ...LIVE_SETTLED_FIRST,
          upvotes: {
            [LIVE_VOTER_UPVOTE]: JUST_BEFORE_FULL_TIME,
            [PREVIOUS_DAY_VOTER_UPVOTE]: JUST_BEFORE_FULL_TIME,
          },
        }),
      );
    });

    test('noneでは、Upvoteを論理削除せず集計値も変えない', async () => {
      await closeUser(VOTER, 'none', DURING_MATCH);

      await expect(readScenario()).resolves.toEqual(expectedScenario({}));
    });
  });
});
