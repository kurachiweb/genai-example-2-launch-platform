import { beforeEach, describe, expect, test } from 'vitest';

import type { MatchOutcome } from '../../../lib/core/match/match-decision.ts';
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
import { db } from '../../../lib/workers/product/testing/product-fixtures.ts';
import type { SettlementWrite } from '../../application/match/ports.ts';
import { D1SettlementStore } from './d1-settlement-store.ts';
import {
  DURING_MATCH,
  ENDS_AT,
  JUST_BEFORE_FULL_TIME,
  secondsAfterStart,
  seedUpvoteParticipants,
  STARTS_AT,
  twoSidedMatch,
} from './testing/upvote-store-fixtures.ts';

const SETTLE_AT = new Date(ENDS_AT.getTime() + 5000);

const store = new D1SettlementStore(db);

function eventIdOf(index: number): string {
  return `01JD0STLE${String(index).padStart(17, '0')}`;
}

// 側1が勝つ決着
function slotOneWins(matchIndex: number): MatchOutcome {
  return {
    decision: 'votes',
    results: new Map([
      [entryIdOf(matchIndex * 10 + 1), 'won'],
      [entryIdOf(matchIndex * 10 + 2), 'lost'],
    ]),
  };
}

function writeOf(matchIndex: number, eventIndex = matchIndex): SettlementWrite {
  return {
    matchId: matchIdOf(matchIndex),
    outcome: slotOneWins(matchIndex),
    eventId: eventIdOf(eventIndex),
  };
}

// 側1が3票(最後は開始の60秒後・記録の順7)、側2が1票のマッチ中のマッチ
function liveMatch(index: number, columns = {}) {
  const match = twoSidedMatch(index, { startedAt: STARTS_AT, ...columns });
  const [first, second] = match.entries;
  if (first === undefined || second === undefined) {
    throw new Error('側が2つありません');
  }
  return {
    ...match,
    entries: [
      {
        ...first,
        columns: {
          upvoteCount: 3,
          lastUpvotedAt: secondsAfterStart(60),
          lastUpvoteSeq: 7,
        },
      },
      {
        ...second,
        columns: {
          upvoteCount: 1,
          lastUpvotedAt: secondsAfterStart(30),
          lastUpvoteSeq: 2,
        },
      },
    ],
  };
}

beforeEach(async () => {
  await seedUpvoteParticipants();
});

describe('D1SettlementStore.listDue', () => {
  test('開始が記録され終了の日時を過ぎた未確定のマッチを、保存済みの集計値付きで側の番号の順に返す', async () => {
    await insertMatches([liveMatch(1)]);

    expect(await store.listDue(SETTLE_AT, 100)).toEqual([
      {
        matchId: matchIdOf(1),
        entryCount: 2,
        entries: [
          {
            entryId: entryIdOf(11),
            upvoteCount: 3,
            lastUpvotedAt: secondsAfterStart(60),
            lastUpvoteSeq: 7,
          },
          {
            entryId: entryIdOf(12),
            upvoteCount: 1,
            lastUpvotedAt: secondsAfterStart(30),
            lastUpvoteSeq: 2,
          },
        ],
      },
    ]);
  });

  test('終了の日時ちょうどのマッチを含め、開始の記録の前・確定済み・終了の日時の前のマッチを含めない', async () => {
    const later = new Date(ENDS_AT.getTime() + 3_600_000);
    await insertMatches([
      liveMatch(1),
      twoSidedMatch(2, { startedAt: null }),
      liveMatch(3, { decidedAt: JUST_BEFORE_FULL_TIME, decision: 'walkover' }),
      liveMatch(4, { kind: 'week', endsAt: later }),
    ]);

    expect(
      (await store.listDue(ENDS_AT, 100)).map((match) => match.matchId),
    ).toEqual([matchIdOf(1)]);
    expect(
      (await store.listDue(JUST_BEFORE_FULL_TIME, 100)).map(
        (match) => match.matchId,
      ),
    ).toEqual([]);
    expect(
      (await store.listDue(later, 100)).map((match) => match.matchId),
    ).toEqual([matchIdOf(1), matchIdOf(4)]);
  });

  test('件数の上限はマッチの数に掛かり、終了の日時とIDの順に返す', async () => {
    const earlier = new Date(ENDS_AT.getTime() - 3_600_000);
    await insertMatches([
      liveMatch(1),
      liveMatch(2),
      liveMatch(3, { kind: 'week', endsAt: earlier }),
    ]);

    const due = await store.listDue(SETTLE_AT, 2);

    expect(due.map((match) => match.matchId)).toEqual([
      matchIdOf(3),
      matchIdOf(1),
    ]);
    expect(due.map((match) => match.entries.length)).toEqual([2, 2]);
  });

  test('有効なUpvoteから数え直さず、保存済みのUpvote数と最終Upvote時間と記録の順を返す', async () => {
    await insertMatches([liveMatch(1)]);

    const [due] = await store.listDue(SETTLE_AT, 100);

    expect(due?.entries.map((entry) => entry.upvoteCount)).toEqual([3, 1]);
  });

  test('100件を超える側のマッチも1回で読む', async () => {
    await insertMatches(
      Array.from({ length: 60 }, (_, index) => liveMatch(index + 1)),
    );

    const due = await store.listDue(SETTLE_AT, 100);

    expect(due).toHaveLength(60);
    expect(due.every((match) => match.entryCount === 2)).toBe(true);
  });
});

describe('D1SettlementStore.writeOutcomes', () => {
  test('側の結果・マッチの確定・確定のイベントを書き、確定したマッチのイベントのIDを返す', async () => {
    await insertMatches([liveMatch(1)]);

    const eventIds = await store.writeOutcomes([writeOf(1)], SETTLE_AT);

    expect(eventIds).toEqual([eventIdOf(1)]);
    expect(await readMatchRows()).toEqual([
      expect.objectContaining({
        id: matchIdOf(1),
        decidedAt: SETTLE_AT,
        decision: 'votes',
        endedEarlyAt: null,
        updatedAt: SETTLE_AT,
      }),
    ]);
    expect(await readEntryRows()).toEqual([
      expect.objectContaining({
        id: entryIdOf(11),
        result: 'won',
        upvoteCount: 3,
        lastUpvotedAt: secondsAfterStart(60),
        lastUpvoteSeq: 7,
        updatedAt: SETTLE_AT,
      }),
      expect.objectContaining({
        id: entryIdOf(12),
        result: 'lost',
        upvoteCount: 1,
        lastUpvotedAt: secondsAfterStart(30),
        lastUpvoteSeq: 2,
        updatedAt: SETTLE_AT,
      }),
    ]);
    expect(await readMatchEvents()).toEqual([
      expect.objectContaining({
        id: eventIdOf(1),
        matchId: matchIdOf(1),
        matchKind: 'qualifier',
        type: 'decided',
        occurredAt: SETTLE_AT,
        status: 'pending',
        dispatchCount: 1,
        lastDispatchedAt: SETTLE_AT,
        completedAt: null,
      }),
    ]);
  });

  test('両側0票の両者敗北も、側の結果とマッチの決着に書く', async () => {
    await insertMatches([twoSidedMatch(1)]);

    await store.writeOutcomes(
      [
        {
          matchId: matchIdOf(1),
          outcome: {
            decision: 'no_votes',
            results: new Map([
              [entryIdOf(11), 'lost'],
              [entryIdOf(12), 'lost'],
            ]),
          },
          eventId: eventIdOf(1),
        },
      ],
      SETTLE_AT,
    );

    expect((await readMatchRows())[0]?.decision).toBe('no_votes');
    expect((await readEntryRows()).map((entry) => entry.result)).toEqual([
      'lost',
      'lost',
    ]);
  });

  test('50マッチを1回で確定し、51マッチは何も書かずに拒否する', async () => {
    await insertMatches(
      Array.from({ length: 51 }, (_, index) => liveMatch(index + 1)),
    );
    const writes = Array.from({ length: 51 }, (_, index) => writeOf(index + 1));

    await expect(store.writeOutcomes(writes, SETTLE_AT)).rejects.toThrow(
      RangeError,
    );
    expect(await readMatchEvents()).toEqual([]);

    const eventIds = await store.writeOutcomes(writes.slice(0, 50), SETTLE_AT);

    expect(eventIds).toHaveLength(50);
    expect(
      (await readMatchRows()).filter((match) => match.decidedAt !== null),
    ).toHaveLength(50);
    expect(await readMatchEvents()).toHaveLength(50);
  });

  test('空の一覧では何も書かない', async () => {
    expect(await store.writeOutcomes([], SETTLE_AT)).toEqual([]);
  });

  test('2回実行しても結果は変わらず、イベントも1件のまま', async () => {
    await insertMatches([liveMatch(1)]);
    await store.writeOutcomes([writeOf(1)], SETTLE_AT);
    const before = {
      matches: await readMatchRows(),
      entries: await readEntryRows(),
    };

    const later = new Date(SETTLE_AT.getTime() + 300_000);
    const again = await store.writeOutcomes(
      [
        {
          matchId: matchIdOf(1),
          outcome: {
            decision: 'votes',
            results: new Map([
              [entryIdOf(11), 'lost'],
              [entryIdOf(12), 'won'],
            ]),
          },
          eventId: eventIdOf(2),
        },
      ],
      later,
    );

    expect(again).toEqual([]);
    expect(await store.listDue(later, 100)).toEqual([]);
    expect({
      matches: await readMatchRows(),
      entries: await readEntryRows(),
    }).toEqual(before);
    expect((await readMatchEvents()).map((event) => event.id)).toEqual([
      eventIdOf(1),
    ]);
  });

  test('終了の日時の前と開始の記録の前のマッチは確定しない', async () => {
    await insertMatches([liveMatch(1), twoSidedMatch(2, { startedAt: null })]);

    expect(await store.writeOutcomes([writeOf(1)], DURING_MATCH)).toEqual([]);
    expect(await store.writeOutcomes([writeOf(2)], SETTLE_AT)).toEqual([]);
    expect((await readMatchRows()).map((match) => match.decidedAt)).toEqual([
      null,
      null,
    ]);
    expect((await readEntryRows()).map((entry) => entry.result)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(await readMatchEvents()).toEqual([]);
  });
});
