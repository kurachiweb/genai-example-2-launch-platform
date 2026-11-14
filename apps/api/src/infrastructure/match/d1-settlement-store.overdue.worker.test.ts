import { beforeEach, describe, expect, test } from 'vitest';

import { insertMatches } from '../../../lib/workers/match/testing/match-fixtures.ts';
import { db } from '../../../lib/workers/product/testing/product-fixtures.ts';
import { D1SettlementStore } from './d1-settlement-store.ts';
import {
  ENDS_AT,
  seedUpvoteParticipants,
  STARTS_AT,
  twoSidedMatch,
} from './testing/upvote-store-fixtures.ts';

const store = new D1SettlementStore(db);

const ONE_HOUR_MS = 3_600_000;

const LATER_ENDS_AT = new Date(ENDS_AT.getTime() + ONE_HOUR_MS);

beforeEach(async () => {
  await seedUpvoteParticipants();
});

describe('D1SettlementStore.countOverdue', () => {
  test('終了の日時が指定の時刻より前の未確定のマッチを、開始の記録の有無によらず数える', async () => {
    await insertMatches([
      twoSidedMatch(1, { startedAt: STARTS_AT }),
      twoSidedMatch(2, { startedAt: null }),
      twoSidedMatch(3, {
        startedAt: STARTS_AT,
        decidedAt: ENDS_AT,
        decision: 'votes',
      }),
      twoSidedMatch(4, { startedAt: STARTS_AT, endsAt: LATER_ENDS_AT }),
    ]);

    expect(await store.countOverdue(new Date(ENDS_AT.getTime() + 1))).toBe(2);
    expect(
      await store.countOverdue(new Date(LATER_ENDS_AT.getTime() + 1)),
    ).toBe(3);
  });

  test('終了の日時ちょうどの時刻を渡したマッチは数えない', async () => {
    await insertMatches([twoSidedMatch(1, { startedAt: STARTS_AT })]);

    expect(await store.countOverdue(ENDS_AT)).toBe(0);
  });

  test('マッチが無ければ0を返す', async () => {
    expect(await store.countOverdue(LATER_ENDS_AT)).toBe(0);
  });
});
