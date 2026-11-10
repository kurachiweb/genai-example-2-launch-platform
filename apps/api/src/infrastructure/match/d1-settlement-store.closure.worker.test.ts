import { beforeEach, describe, expect, test } from 'vitest';

import {
  readEntryRows,
  readMatchEvents,
  readMatchRows,
} from '../../../lib/workers/match/testing/event-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  matchIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { D1SettlementStore } from './d1-settlement-store.ts';
import { matchClosureStatements } from './match-closure-statements.ts';
import {
  ENDS_AT,
  JUST_BEFORE_FULL_TIME,
  OWNER_A,
  seedUpvoteParticipants,
  STARTS_AT,
  twoSidedMatch,
} from './testing/upvote-store-fixtures.ts';

const SETTLE_AT = new Date(ENDS_AT.getTime() + 5000);

const store = new D1SettlementStore(db);

function eventIdOf(index: number): string {
  return `01JD0STLE${String(index).padStart(17, '0')}`;
}

function writeOf(matchIndex: number) {
  return {
    matchId: matchIdOf(matchIndex),
    outcome: {
      decision: 'votes' as const,
      results: new Map([
        [entryIdOf(matchIndex * 10 + 1), 'won' as const],
        [entryIdOf(matchIndex * 10 + 2), 'lost' as const],
      ]),
    },
    eventId: eventIdOf(matchIndex),
  };
}

// 投稿者Aの停止の確定と同じ一括の書き込みで、マッチ中のマッチを即時に終了する
async function suspendOwnerA(): Promise<void> {
  const [first, ...rest] = matchClosureStatements(db, {
    subject: { kind: 'user', userId: userIdOf(OWNER_A) },
    upvotes: 'live',
    at: JUST_BEFORE_FULL_TIME,
  });
  if (first === undefined) {
    throw new Error('文が返されませんでした');
  }
  await db.batch([first, ...rest]);
}

beforeEach(async () => {
  await seedUpvoteParticipants();
});

describe('D1SettlementStore.writeOutcomesと即時の終了の競合', () => {
  test('読み取りの後に即時の終了が先に確定したマッチは変えずイベントも作らず、同じ書き込みの他のマッチだけを確定する', async () => {
    await insertMatches([twoSidedMatch(1, { startedAt: STARTS_AT })]);
    const [due] = await store.listDue(SETTLE_AT, 100);
    expect(due?.matchId).toBe(matchIdOf(1));
    await suspendOwnerA();
    await insertMatches([twoSidedMatch(2, { startedAt: STARTS_AT })]);
    const closed = {
      match: (await readMatchRows())[0],
      entries: (await readEntryRows()).slice(0, 2),
    };
    expect(closed.match).toMatchObject({
      decision: 'walkover',
      endedEarlyAt: JUST_BEFORE_FULL_TIME,
    });

    const eventIds = await store.writeOutcomes(
      [writeOf(1), writeOf(2)],
      SETTLE_AT,
    );

    expect(eventIds).toEqual([eventIdOf(2)]);
    expect((await readMatchRows())[0]).toEqual(closed.match);
    expect((await readEntryRows()).slice(0, 2)).toEqual(closed.entries);
    expect(
      (await readEntryRows()).slice(2).map((entry) => entry.result),
    ).toEqual(['won', 'lost']);
    expect((await readMatchEvents()).map((event) => event.matchId)).toEqual([
      matchIdOf(2),
    ]);
  });

  test('確定の後の即時の終了は、確定した結果を変えない', async () => {
    await insertMatches([twoSidedMatch(1, { startedAt: STARTS_AT })]);
    await store.writeOutcomes([writeOf(1)], SETTLE_AT);
    const settled = {
      matches: await readMatchRows(),
      entries: await readEntryRows(),
    };

    await suspendOwnerA();

    expect({
      matches: await readMatchRows(),
      entries: await readEntryRows(),
    }).toEqual(settled);
  });
});
