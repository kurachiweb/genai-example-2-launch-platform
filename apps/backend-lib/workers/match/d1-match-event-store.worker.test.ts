import { beforeEach, describe, expect, test } from 'vitest';

import type { MatchKind } from '../../core/match/match-model.ts';
import type { StoredMatchEvent } from '../../core/match/ports.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import { db, T0 } from '../product/testing/product-fixtures.ts';
import { D1MatchEventStore } from './d1-match-event-store.ts';
import { seedDirectoryOwners } from './testing/directory-fixtures.ts';
import {
  createSequentialIds,
  insertHandlerRun,
  insertMatchEvents,
  matchEventIdOf,
  readHandlerRuns,
  readMatchEvent,
  readMatchEvents,
  sequentialIdOf,
} from './testing/event-fixtures.ts';
import {
  insertMatches,
  type MatchFixture,
  matchIdOf,
} from './testing/match-fixtures.ts';

const HANDLER_A = 'match-engine.qualifier-outcome';
const HANDLER_B = 'notifications.match-result';

const MINUTE = 60_000;

const DAY = 86_400_000;

const AT = new Date('2026-11-21T19:21:00.000Z');

function minutesAfter(minutes: number): Date {
  return new Date(T0.getTime() + minutes * MINUTE);
}

function pendingMatch(index: number): MatchFixture {
  return { index, entries: [] };
}

function decidedMatch(
  index: number,
  decidedAt: Date,
  kind: MatchKind = 'qualifier',
): MatchFixture {
  return {
    index,
    columns: { kind, startedAt: T0, decidedAt, decision: 'no_votes' },
    entries: [],
  };
}

let store: D1MatchEventStore;

beforeEach(async () => {
  await seedDirectoryOwners();
  store = new D1MatchEventStore(db, createSequentialIds());
});

describe('findEvent', () => {
  test('記録されたイベントを種別・状態・送信の回数付きで返し、無いIDはundefinedを返す', async () => {
    await insertMatches([decidedMatch(1, minutesAfter(10), 'week')]);
    await insertMatchEvents([
      {
        index: 1,
        match: 1,
        type: 'decided',
        occurredAt: minutesAfter(10),
        columns: {
          matchKind: 'week',
          dispatchCount: 3,
          lastDispatchedAt: minutesAfter(70),
        },
      },
    ]);

    expect(await store.findEvent(matchEventIdOf(1))).toEqual<StoredMatchEvent>({
      id: matchEventIdOf(1),
      matchId: matchIdOf(1),
      kind: 'week',
      type: 'decided',
      occurredAt: minutesAfter(10),
      status: 'pending',
      dispatchCount: 3,
      lastDispatchedAt: minutesAfter(70),
    });
    expect(await store.findEvent(matchEventIdOf(9))).toBeUndefined();
  });
});

describe('findOldestPending', () => {
  test('同じマッチの未完了のイベントのうち発生日時の最も古いものを、同時刻ならIDの小さいものを返す', async () => {
    await insertMatches([pendingMatch(1), pendingMatch(2)]);
    await insertMatchEvents([
      {
        index: 1,
        match: 1,
        type: 'scheduled',
        occurredAt: minutesAfter(0),
        columns: { status: 'completed', completedAt: minutesAfter(1) },
      },
      { index: 3, match: 1, type: 'decided', occurredAt: minutesAfter(5) },
      { index: 2, match: 1, type: 'started', occurredAt: minutesAfter(5) },
      { index: 4, match: 2, type: 'scheduled', occurredAt: minutesAfter(-9) },
    ]);

    expect((await store.findOldestPending(matchIdOf(1)))?.id).toBe(
      matchEventIdOf(2),
    );
    expect(await store.findOldestPending(matchIdOf(3))).toBeUndefined();
  });
});

describe('処理の完了の記録', () => {
  test('完了した処理の名前を返し、同じ処理の完了の記録の重複を無視する', async () => {
    await insertMatches([pendingMatch(1)]);
    await insertMatchEvents([
      { index: 1, match: 1, type: 'scheduled', occurredAt: T0 },
      { index: 2, match: 1, type: 'started', occurredAt: T0 },
    ]);
    await insertHandlerRun(1, 2, HANDLER_B);

    await store.markHandlerCompleted(matchEventIdOf(1), HANDLER_A, AT);
    await store.markHandlerCompleted(
      matchEventIdOf(1),
      HANDLER_A,
      new Date(AT.getTime() + MINUTE),
    );

    expect(await store.completedHandlers(matchEventIdOf(1))).toEqual(
      new Set([HANDLER_A]),
    );
    expect(await store.completedHandlers(matchEventIdOf(2))).toEqual(
      new Set([HANDLER_B]),
    );
    expect(await readHandlerRuns()).toEqual([
      { eventId: matchEventIdOf(1), handlerName: HANDLER_A, completedAt: AT },
      { eventId: matchEventIdOf(2), handlerName: HANDLER_B, completedAt: T0 },
    ]);
  });

  test('イベントを完了にし、既に完了したイベントの完了の日時を変えない', async () => {
    await insertMatches([pendingMatch(1)]);
    await insertMatchEvents([
      { index: 1, match: 1, type: 'scheduled', occurredAt: T0 },
    ]);

    await store.markEventCompleted(matchEventIdOf(1), AT);
    await store.markEventCompleted(
      matchEventIdOf(1),
      new Date(AT.getTime() + DAY),
    );

    expect(await readMatchEvent(matchEventIdOf(1))).toMatchObject({
      status: 'completed',
      completedAt: AT,
    });
  });
});

describe('createMissingDecidedEvents', () => {
  test('指定した日時以降に確定し確定のイベントが無いマッチに、確定の日時を発生日時にしたイベントを作る', async () => {
    const since = minutesAfter(100);
    await insertMatches([
      decidedMatch(1, minutesAfter(110)),
      decidedMatch(2, minutesAfter(105), 'year'),
      decidedMatch(3, minutesAfter(120)),
      decidedMatch(4, minutesAfter(99)),
      pendingMatch(5),
    ]);
    await insertMatchEvents([
      { index: 1, match: 3, type: 'decided', occurredAt: minutesAfter(120) },
      { index: 2, match: 1, type: 'started', occurredAt: T0 },
    ]);

    const created = await store.createMissingDecidedEvents(since, AT, 10);

    expect(created).toEqual([sequentialIdOf(1), sequentialIdOf(2)]);
    const rows = await readMatchEvents();
    expect(rows.filter((row) => created.includes(row.id))).toMatchObject([
      {
        id: sequentialIdOf(2),
        matchId: matchIdOf(1),
        matchKind: 'qualifier',
        type: 'decided',
        occurredAt: minutesAfter(110),
        status: 'pending',
        dispatchCount: 1,
        lastDispatchedAt: AT,
      },
      {
        id: sequentialIdOf(1),
        matchId: matchIdOf(2),
        matchKind: 'year',
        type: 'decided',
        occurredAt: minutesAfter(105),
      },
    ]);
  });

  test('9件以上のイベントは各文のバインド変数を上限内にして分けて作る', async () => {
    const indexes = Array.from({ length: 20 }, (_, i) => i + 1);
    await insertMatches(
      indexes.map((index) => decidedMatch(index, minutesAfter(index))),
    );
    const { database, placeholderCounts } = createRecordingDatabase();

    const created = await new D1MatchEventStore(
      database,
      createSequentialIds(),
    ).createMissingDecidedEvents(T0, AT, indexes.length);

    expect(created).toHaveLength(indexes.length);
    expectSplitWithinBindLimit(placeholderCounts.slice(1));
    expect(
      (await readMatchEvents()).map((row) => [row.matchId, row.type]),
    ).toEqual(indexes.map((index) => [matchIdOf(index), 'decided']));
  });

  test('2回実行しても1件で、上限の件数だけを作る', async () => {
    await insertMatches([
      decidedMatch(1, minutesAfter(1)),
      decidedMatch(2, minutesAfter(2)),
      decidedMatch(3, minutesAfter(3)),
    ]);

    const first = await store.createMissingDecidedEvents(T0, AT, 2);
    const second = await store.createMissingDecidedEvents(T0, AT, 2);
    const third = await store.createMissingDecidedEvents(T0, AT, 2);

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
    expect(third).toEqual([]);
    expect(
      (await readMatchEvents()).map((row) => [row.matchId, row.type]),
    ).toEqual([
      [matchIdOf(1), 'decided'],
      [matchIdOf(2), 'decided'],
      [matchIdOf(3), 'decided'],
    ]);
  });
});

describe('listStalePending・markRedispatched', () => {
  test('最後の送信が指定の日時より前の未完了のイベントを、最後の送信の古い順に上限まで返す', async () => {
    await insertMatches([pendingMatch(1), pendingMatch(2)]);
    await insertMatchEvents([
      {
        index: 1,
        match: 1,
        type: 'scheduled',
        occurredAt: minutesAfter(30),
      },
      { index: 2, match: 1, type: 'started', occurredAt: minutesAfter(10) },
      { index: 3, match: 2, type: 'scheduled', occurredAt: minutesAfter(20) },
      {
        index: 4,
        match: 2,
        type: 'started',
        occurredAt: minutesAfter(0),
        columns: { status: 'completed', completedAt: minutesAfter(1) },
      },
      { index: 5, match: 2, type: 'decided', occurredAt: minutesAfter(60) },
    ]);

    const stale = await store.listStalePending(minutesAfter(60), 2);

    expect(stale.map((event) => event.id)).toEqual([
      matchEventIdOf(2),
      matchEventIdOf(3),
    ]);
  });

  test('送り直したイベントの送信の回数を1増やし最後の送信の日時を更新し、完了したイベントは変えない', async () => {
    await insertMatches([pendingMatch(1)]);
    await insertMatchEvents([
      { index: 1, match: 1, type: 'scheduled', occurredAt: T0 },
      {
        index: 2,
        match: 1,
        type: 'started',
        occurredAt: T0,
        columns: { status: 'completed', completedAt: T0 },
      },
    ]);

    await store.markRedispatched(
      [matchEventIdOf(1), matchEventIdOf(1), matchEventIdOf(2)],
      AT,
    );

    expect(await readMatchEvents()).toMatchObject([
      { id: matchEventIdOf(1), dispatchCount: 2, lastDispatchedAt: AT },
      { id: matchEventIdOf(2), dispatchCount: 1, lastDispatchedAt: T0 },
    ]);
  });

  test('90件を超えるIDは分けて更新する', async () => {
    const indexes = Array.from({ length: 95 }, (_, i) => i + 1);
    await insertMatches(indexes.map(pendingMatch));
    await insertMatchEvents(
      indexes.map((index) => ({
        index,
        match: index,
        type: 'scheduled' as const,
        occurredAt: T0,
      })),
    );
    const { database, placeholderCounts } = createRecordingDatabase();

    await new D1MatchEventStore(
      database,
      createSequentialIds(),
    ).markRedispatched(indexes.map(matchEventIdOf), AT);

    expectSplitWithinBindLimit(placeholderCounts);
    const rows = await readMatchEvents();
    expect(rows.every((row) => row.dispatchCount === 2)).toBe(true);
  });
});

describe('deleteCompletedBefore', () => {
  test('完了の日時が指定より前のイベントと処理の記録を古い順に上限まで消し、消した数を返す', async () => {
    await insertMatches([pendingMatch(1), pendingMatch(2)]);
    const completed = (
      index: number,
      type: 'scheduled' | 'started' | 'decided',
      minutes: number,
    ) => ({
      index,
      match: index <= 3 ? 1 : 2,
      type,
      occurredAt: T0,
      columns: {
        status: 'completed' as const,
        completedAt: minutesAfter(minutes),
      },
    });
    await insertMatchEvents([
      completed(1, 'scheduled', 10),
      completed(2, 'started', 30),
      completed(3, 'decided', 20),
      completed(4, 'scheduled', 200),
      { index: 5, match: 2, type: 'started', occurredAt: T0 },
    ]);
    await insertHandlerRun(1, 1, HANDLER_A);
    await insertHandlerRun(2, 3, HANDLER_A);
    await insertHandlerRun(3, 3, HANDLER_B);
    await insertHandlerRun(4, 2, HANDLER_A);

    const deleted = await store.deleteCompletedBefore(minutesAfter(100), 2);

    expect(deleted).toBe(2);
    expect((await readMatchEvents()).map((row) => row.id)).toEqual([
      matchEventIdOf(2),
      matchEventIdOf(4),
      matchEventIdOf(5),
    ]);
    expect((await readHandlerRuns()).map((run) => run.eventId)).toEqual([
      matchEventIdOf(2),
    ]);
    expect(await store.deleteCompletedBefore(minutesAfter(100), 2)).toBe(1);
    expect(await store.deleteCompletedBefore(minutesAfter(100), 2)).toBe(0);
  });

  test('91件以上は各文のバインド変数を上限内にして分けて消す', async () => {
    const indexes = Array.from({ length: 120 }, (_, i) => i + 1);
    await insertMatches(indexes.map(pendingMatch));
    await insertMatchEvents(
      indexes.map((index) => ({
        index,
        match: index,
        type: 'scheduled' as const,
        occurredAt: T0,
        columns: {
          status: 'completed' as const,
          completedAt: minutesAfter(index),
        },
      })),
    );
    await insertHandlerRun(1, 1, HANDLER_A);
    await insertHandlerRun(2, 120, HANDLER_A);
    const { database, placeholderCounts } = createRecordingDatabase();

    const deleted = await new D1MatchEventStore(
      database,
      createSequentialIds(),
    ).deleteCompletedBefore(minutesAfter(1000), indexes.length);

    expect(deleted).toBe(indexes.length);
    expectSplitWithinBindLimit(placeholderCounts.slice(1));
    expect(await readMatchEvents()).toEqual([]);
    expect(await readHandlerRuns()).toEqual([]);
  });
});
