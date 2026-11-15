import { asc, type SQL, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { matches } from '../../../db/schema/match/matches.ts';
import { DECIDED_AT } from '../../../lib/workers/match/testing/directory-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  matchIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
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
  seedUpvoteParticipants,
  STARTS_AT,
  SUSPENDED,
  twoSidedMatch,
  UNVERIFIED,
  VOTER,
  WITHDRAWN,
} from './testing/upvote-store-fixtures.ts';
import { acceptingCondition, upvoteAllowedCondition } from './upvote-guards.ts';

const NOT_STARTED = 2;

const DECIDED = 3;

async function acceptingMatchIds(now: Date): Promise<string[]> {
  const rows = await db
    .select({ id: matches.id })
    .from(matches)
    .where(acceptingCondition(matches.id, now))
    .orderBy(asc(matches.id));
  return rows.map(({ id }) => id);
}

async function holds(condition: SQL): Promise<boolean> {
  const row = await db.get<{ held: number }>(
    sql`SELECT CASE WHEN ${condition} THEN 1 ELSE 0 END AS held`,
  );
  return row?.held === 1;
}

beforeEach(seedUpvoteParticipants);

describe('acceptingCondition', () => {
  beforeEach(async () => {
    await insertLiveMatch();
    await insertMatches([
      twoSidedMatch(NOT_STARTED, {}),
      twoSidedMatch(DECIDED, { startedAt: STARTS_AT, decidedAt: DECIDED_AT }),
    ]);
  });

  test('開始が記録され、確定しておらず、終了の日時より前のマッチだけに当たる', async () => {
    expect(await acceptingMatchIds(DURING_MATCH)).toEqual([
      matchIdOf(LIVE_MATCH),
    ]);
  });

  test('23:39:59には当たり、23:40には当たらない', async () => {
    expect(await acceptingMatchIds(JUST_BEFORE_FULL_TIME)).toEqual([
      matchIdOf(LIVE_MATCH),
    ]);
    expect(await acceptingMatchIds(ENDS_AT)).toEqual([]);
  });
});

describe('upvoteAllowedCondition', () => {
  beforeEach(insertLiveMatch);

  const allowed = (
    overrides: Partial<Parameters<typeof upvoteAllowedCondition>[0]> = {},
  ): Promise<boolean> =>
    holds(
      upvoteAllowedCondition({
        matchId: matchIdOf(LIVE_MATCH),
        entryId: entryIdOf(ENTRY_A),
        userId: userIdOf(VOTER),
        now: DURING_MATCH,
        ...overrides,
      }),
    );

  test('確認済みの利用者が受け付け中のマッチの側へUpvoteする場合に成り立つ', async () => {
    expect(await allowed()).toBe(true);
    expect(await allowed({ entryId: entryIdOf(ENTRY_B) })).toBe(true);
  });

  test.each([
    { name: '終了の日時(23:40)', overrides: { now: ENDS_AT } },
    {
      name: '存在しないマッチ',
      overrides: { matchId: matchIdOf(99) },
    },
    {
      name: 'マッチに無い側',
      overrides: { entryId: entryIdOf(99) },
    },
    {
      name: '自分のプロダクトの側',
      overrides: { userId: userIdOf(OWNER_A) },
    },
    {
      name: '自分のプロダクトの対戦相手の側',
      overrides: { userId: userIdOf(OWNER_B) },
    },
    {
      name: 'メールアドレスが未確認の利用者',
      overrides: { userId: userIdOf(UNVERIFIED) },
    },
    { name: '停止中の利用者', overrides: { userId: userIdOf(SUSPENDED) } },
    { name: '退会済みの利用者', overrides: { userId: userIdOf(WITHDRAWN) } },
  ])('$nameでは成り立たない', async ({ overrides }) => {
    expect(await allowed(overrides)).toBe(false);
  });
});
