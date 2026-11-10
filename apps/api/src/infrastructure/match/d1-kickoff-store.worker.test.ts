import { beforeEach, describe, expect, test } from 'vitest';

import type { KickoffOutcome } from '../../../lib/core/match/match-decision.ts';
import {
  readEntryRows,
  readMatchEvents,
  readMatchRows,
} from '../../../lib/workers/match/testing/event-fixtures.ts';
import {
  entryIdOf,
  insertMatches,
  type MatchFixture,
  matchIdOf,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import { db } from '../../../lib/workers/product/testing/product-fixtures.ts';
import type { KickoffWrite } from '../../application/match/ports.ts';
import { D1KickoffStore } from './d1-kickoff-store.ts';
import {
  OWNER_A,
  seedUpvoteParticipants,
  STARTS_AT,
  twoSidedMatch,
} from './testing/upvote-store-fixtures.ts';

const KICKOFF_AT = new Date(STARTS_AT.getTime() + 5000);

const JUST_BEFORE_KICKOFF = new Date(STARTS_AT.getTime() - 1000);

const FORFEITED_AT = new Date(STARTS_AT.getTime() - 3_600_000);

const store = new D1KickoffStore(db);

function eventIdOf(index: number): string {
  return `01JD0KCKE${String(index).padStart(17, '0')}`;
}

function scheduledMatch(
  index: number,
  columns: MatchFixture['columns'] = {},
): MatchFixture {
  return twoSidedMatch(index, columns);
}

function byeMatch(index: number): MatchFixture {
  return {
    index,
    entries: [
      { index: index * 10 + 1, launch: null, product: 1, owner: OWNER_A },
    ],
  };
}

function startOf(matchIndex: number, eventIndex = matchIndex): KickoffWrite {
  return {
    matchId: matchIdOf(matchIndex),
    outcome: { kind: 'start' },
    eventId: eventIdOf(eventIndex),
    forfeitedEntryIds: [],
  };
}

// 側1が該当し、側2が相手の退会等による勝利
function walkoverOf(matchIndex: number, eventIndex = matchIndex): KickoffWrite {
  const outcome: KickoffOutcome = {
    kind: 'decided',
    outcome: {
      decision: 'walkover',
      results: new Map([
        [entryIdOf(matchIndex * 10 + 1), 'lost'],
        [entryIdOf(matchIndex * 10 + 2), 'walkover'],
      ]),
    },
  };
  return {
    matchId: matchIdOf(matchIndex),
    outcome,
    eventId: eventIdOf(eventIndex),
    forfeitedEntryIds: [entryIdOf(matchIndex * 10 + 1)],
  };
}

function byeOf(matchIndex: number): KickoffWrite {
  return {
    matchId: matchIdOf(matchIndex),
    outcome: {
      kind: 'decided',
      outcome: {
        decision: 'bye',
        results: new Map([[entryIdOf(matchIndex * 10 + 1), 'bye']]),
      },
    },
    eventId: eventIdOf(matchIndex),
    forfeitedEntryIds: [],
  };
}

beforeEach(async () => {
  await seedUpvoteParticipants();
});

describe('D1KickoffStore.listDue', () => {
  test('開始の日時を過ぎた未開始のマッチを、種別と開始の日時と側(番号の順・該当の記録の有無)付きで返す', async () => {
    const match = scheduledMatch(1);
    const [first, second] = match.entries;
    if (first === undefined || second === undefined) {
      throw new Error('側が2つありません');
    }
    await insertMatches([
      {
        ...match,
        entries: [
          { ...first, launch: 1, columns: { forfeitedAt: FORFEITED_AT } },
          { ...second, product: null, owner: null },
        ],
      },
    ]);

    expect(await store.listDue(KICKOFF_AT, 100)).toEqual([
      {
        matchId: matchIdOf(1),
        kind: 'qualifier',
        startsAt: STARTS_AT,
        entries: [
          {
            entryId: entryIdOf(11),
            launchId: expect.any(String) as string,
            productId: expect.any(String) as string,
            forfeited: true,
          },
          {
            entryId: entryIdOf(12),
            launchId: null,
            productId: null,
            forfeited: false,
          },
        ],
      },
    ]);
  });

  test('開始の日時の直前(前日の23:59:59)には返さず、開始の日時ちょうどから返す', async () => {
    await insertMatches([scheduledMatch(1)]);

    expect(await store.listDue(JUST_BEFORE_KICKOFF, 100)).toEqual([]);
    expect(
      (await store.listDue(STARTS_AT, 100)).map((match) => match.matchId),
    ).toEqual([matchIdOf(1)]);
  });

  test('開始済み・確定済み(予定の間の即時の決着を含む)のマッチを含めない', async () => {
    await insertMatches([
      scheduledMatch(1),
      scheduledMatch(2, { startedAt: STARTS_AT }),
      scheduledMatch(3, { decidedAt: FORFEITED_AT, decision: 'walkover' }),
    ]);

    expect(
      (await store.listDue(KICKOFF_AT, 100)).map((match) => match.matchId),
    ).toEqual([matchIdOf(1)]);
  });

  test('件数の上限はマッチの数に掛かり、開始の日時とIDの順に返す', async () => {
    const earlier = new Date(STARTS_AT.getTime() - 86_400_000);
    await insertMatches([
      scheduledMatch(1),
      byeMatch(2),
      scheduledMatch(3, {
        kind: 'week',
        startsAt: earlier,
        matchDate: '2026-11-19',
      }),
    ]);

    const due = await store.listDue(KICKOFF_AT, 2);

    expect(due.map((match) => [match.matchId, match.kind])).toEqual([
      [matchIdOf(3), 'week'],
      [matchIdOf(1), 'qualifier'],
    ]);
    expect(due.map((match) => match.entries.length)).toEqual([2, 2]);
  });
});

describe('D1KickoffStore.writeKickoffs', () => {
  test('開始では開始の日時と開始のイベントだけを書き、側の結果を書かない', async () => {
    await insertMatches([scheduledMatch(1)]);

    const eventIds = await store.writeKickoffs([startOf(1)], KICKOFF_AT);

    expect(eventIds).toEqual([eventIdOf(1)]);
    expect(await readMatchRows()).toEqual([
      expect.objectContaining({
        id: matchIdOf(1),
        startedAt: KICKOFF_AT,
        decidedAt: null,
        decision: null,
        updatedAt: KICKOFF_AT,
      }),
    ]);
    expect((await readEntryRows()).map((entry) => entry.result)).toEqual([
      null,
      null,
    ]);
    expect(await readMatchEvents()).toEqual([
      expect.objectContaining({
        id: eventIdOf(1),
        matchId: matchIdOf(1),
        matchKind: 'qualifier',
        type: 'started',
        occurredAt: KICKOFF_AT,
        status: 'pending',
        dispatchCount: 1,
        lastDispatchedAt: KICKOFF_AT,
      }),
    ]);
  });

  test('決着では開始と確定の日時・決着・側の結果と確定のイベントを書く', async () => {
    await insertMatches([scheduledMatch(1), byeMatch(2)]);

    const eventIds = await store.writeKickoffs(
      [walkoverOf(1), byeOf(2)],
      KICKOFF_AT,
    );

    expect(eventIds).toEqual([eventIdOf(1), eventIdOf(2)]);
    expect(await readMatchRows()).toEqual([
      expect.objectContaining({
        id: matchIdOf(1),
        startedAt: KICKOFF_AT,
        decidedAt: KICKOFF_AT,
        decision: 'walkover',
        endedEarlyAt: null,
      }),
      expect.objectContaining({
        id: matchIdOf(2),
        startedAt: KICKOFF_AT,
        decidedAt: KICKOFF_AT,
        decision: 'bye',
      }),
    ]);
    expect(
      (await readEntryRows()).map((entry) => [entry.id, entry.result]),
    ).toEqual([
      [entryIdOf(11), 'lost'],
      [entryIdOf(12), 'walkover'],
      [entryIdOf(21), 'bye'],
    ]);
    expect(
      (await readMatchEvents()).map((event) => [event.matchId, event.type]),
    ).toEqual([
      [matchIdOf(1), 'decided'],
      [matchIdOf(2), 'decided'],
    ]);
  });

  test('2回書き込んでも、同じマッチを重複して開始・確定せずイベントも作らない', async () => {
    await insertMatches([scheduledMatch(1), scheduledMatch(2)]);
    await store.writeKickoffs([startOf(1), walkoverOf(2)], KICKOFF_AT);
    const before = {
      matches: await readMatchRows(),
      entries: await readEntryRows(),
    };
    const later = new Date(KICKOFF_AT.getTime() + 60_000);

    const eventIds = await store.writeKickoffs(
      [walkoverOf(1, 11), startOf(2, 12)],
      later,
    );

    expect(eventIds).toEqual([]);
    expect(await readMatchRows()).toEqual(before.matches);
    expect(await readEntryRows()).toEqual(before.entries);
    expect((await readMatchEvents()).map((event) => event.id)).toEqual([
      eventIdOf(1),
      eventIdOf(2),
    ]);
  });

  test('予定の間に即時の決着をしたマッチ・開始の日時の前のマッチを変えず、イベントも作らない', async () => {
    await insertMatches([
      scheduledMatch(1, { decidedAt: FORFEITED_AT, decision: 'walkover' }),
      scheduledMatch(2),
    ]);
    const before = await readMatchRows();

    const eventIds = await store.writeKickoffs(
      [startOf(1), startOf(2)],
      JUST_BEFORE_KICKOFF,
    );

    expect(eventIds).toEqual([]);
    expect(await readMatchRows()).toEqual(before);
    expect(await readMatchEvents()).toEqual([]);
  });

  test('判定で該当としなかった側に該当が記録されていれば、そのマッチを書き込まず、他のマッチは書き込む', async () => {
    const forfeitFirst = (index: number): MatchFixture => {
      const match = scheduledMatch(index);
      return {
        ...match,
        entries: match.entries.map((entry, position) =>
          position === 0
            ? { ...entry, columns: { forfeitedAt: FORFEITED_AT } }
            : entry,
        ),
      };
    };
    await insertMatches([forfeitFirst(1), forfeitFirst(2)]);

    const eventIds = await store.writeKickoffs(
      [startOf(1), walkoverOf(2)],
      KICKOFF_AT,
    );

    expect(eventIds).toEqual([eventIdOf(2)]);
    expect(
      (await readMatchRows()).map((match) => [match.id, match.startedAt]),
    ).toEqual([
      [matchIdOf(1), null],
      [matchIdOf(2), KICKOFF_AT],
    ]);
    expect(
      (await readEntryRows()).map((entry) => [entry.id, entry.result]),
    ).toEqual([
      [entryIdOf(11), null],
      [entryIdOf(12), null],
      [entryIdOf(21), 'lost'],
      [entryIdOf(22), 'walkover'],
    ]);
  });

  test('書き込むマッチが無ければ何もせず、51件以上はRangeErrorにする', async () => {
    expect(await store.writeKickoffs([], KICKOFF_AT)).toEqual([]);
    await expect(
      store.writeKickoffs(
        Array.from({ length: 51 }, (_, index) => startOf(index + 1)),
        KICKOFF_AT,
      ),
    ).rejects.toThrow(RangeError);
  });

  test('50マッチを1回で書き込む', async () => {
    await insertMatches(
      Array.from({ length: 50 }, (_, index) => scheduledMatch(index + 1)),
    );

    const eventIds = await store.writeKickoffs(
      Array.from({ length: 50 }, (_, index) => walkoverOf(index + 1)),
      KICKOFF_AT,
    );

    expect(eventIds).toHaveLength(50);
    expect(
      (await readMatchRows()).every(
        (match) => match.decision === 'walkover' && match.startedAt !== null,
      ),
    ).toBe(true);
  });
});
