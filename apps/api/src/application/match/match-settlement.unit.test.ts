import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import {
  MATCH_SETTLEMENT_READ_LIMIT,
  MATCH_SETTLEMENT_TIME_LIMIT_MS,
  MATCH_SETTLEMENT_WRITE_LIMIT,
  StoreMatchSettlement,
} from './match-settlement.ts';
import type { DueSettlement } from './ports.ts';
import {
  createFakeSettlementStore,
  createRecordingMatchEventDispatcher,
  createSettlementIds,
  createSteppingClock,
  dueMatchIdOf,
  dueMatchOf,
  SETTLEMENT_NOW,
  tallyOf,
  unusedClock,
} from './testing/settlement-fakes.ts';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

function matchLogs() {
  return records
    .filter((record) => record.category.join('.') === 'api.application.match')
    .map(({ level, properties }) => ({ level, properties }));
}

function dueMatches(count: number): DueSettlement[] {
  return Array.from({ length: count }, (_, index) => dueMatchOf(index + 1));
}

// 23:40の予定時刻から4分50秒
const DEADLINE = new Date(
  new Date('2027-03-02T14:40:00.000Z').getTime() +
    MATCH_SETTLEMENT_TIME_LIMIT_MS,
);

const BEFORE_DEADLINE = new Date(DEADLINE.getTime() - 1);

function settlementOf(
  store: ReturnType<typeof createFakeSettlementStore>,
  clock = unusedClock,
) {
  const dispatcher = createRecordingMatchEventDispatcher();
  const settlement = new StoreMatchSettlement(
    store,
    dispatcher,
    clock,
    createSettlementIds(),
  );
  return { settlement, dispatcher };
}

describe('StoreMatchSettlement.settleDue', () => {
  test('読み取りは100件・書き込みは50マッチで、打ち切りの時刻は予定時刻から4分50秒である', () => {
    expect(MATCH_SETTLEMENT_READ_LIMIT).toBe(100);
    expect(MATCH_SETTLEMENT_WRITE_LIMIT).toBe(50);
    expect(MATCH_SETTLEMENT_TIME_LIMIT_MS).toBe(290_000);
  });

  test('終了の日時を過ぎた未確定のマッチを100件ずつ無くなるまで読み、50マッチずつ確定する', async () => {
    const store = createFakeSettlementStore(dueMatches(230));
    const { settlement } = settlementOf(store);

    const summary = await settlement.settleDue(SETTLEMENT_NOW);

    expect(summary).toEqual({ settled: 230, truncated: false });
    expect(store.reads).toEqual([
      { now: SETTLEMENT_NOW, limit: 100 },
      { now: SETTLEMENT_NOW, limit: 100 },
      { now: SETTLEMENT_NOW, limit: 100 },
    ]);
    expect(store.writes.map((write) => write.outcomes.length)).toEqual([
      50, 50, 50, 50, 30,
    ]);
    expect(store.writes.every((write) => write.at === SETTLEMENT_NOW)).toBe(
      true,
    );
  });

  test('ちょうど100件の後は、次の読み取りが空になるまで読む', async () => {
    const store = createFakeSettlementStore(dueMatches(100));
    const { settlement } = settlementOf(store);

    const summary = await settlement.settleDue(SETTLEMENT_NOW);

    expect(summary).toEqual({ settled: 100, truncated: false });
    expect(store.reads).toHaveLength(2);
    expect(store.writes).toHaveLength(2);
  });

  test('対象が無ければ書き込まず、送らない', async () => {
    const store = createFakeSettlementStore([]);
    const { settlement, dispatcher } = settlementOf(store);

    expect(await settlement.settleDue(SETTLEMENT_NOW)).toEqual({
      settled: 0,
      truncated: false,
    });
    expect(store.writes).toEqual([]);
    expect(dispatcher.published).toEqual([]);
  });

  test('各マッチの決着を、保存済みの集計値から終了時の決着の規則で作る', async () => {
    const votes = dueMatchOf(1, [
      tallyOf('votes-1', 12, '2027-03-02T05:00:00.000Z', 20),
      tallyOf('votes-2', 9, '2027-03-02T06:00:00.000Z', 21),
    ]);
    const lastUpvote = dueMatchOf(2, [
      tallyOf('tie-1', 7, '2027-03-02T09:30:00.000Z', 40),
      tallyOf('tie-2', 7, '2027-03-02T05:02:00.000Z', 30),
    ]);
    const sameTime = dueMatchOf(3, [
      tallyOf('same-1', 2, '2027-03-02T05:02:00.000Z', 51),
      tallyOf('same-2', 2, '2027-03-02T05:02:00.000Z', 50),
    ]);
    const noVotes = dueMatchOf(4, [tallyOf('zero-1', 0), tallyOf('zero-2', 0)]);
    const store = createFakeSettlementStore([
      votes,
      lastUpvote,
      sameTime,
      noVotes,
    ]);
    const { settlement } = settlementOf(store);

    await settlement.settleDue(SETTLEMENT_NOW);

    const outcomes = store.writes.flatMap((write) => write.outcomes);
    expect(
      outcomes.map(({ matchId, outcome }) => ({
        matchId,
        decision: outcome.decision,
        results: Object.fromEntries(outcome.results),
      })),
    ).toEqual([
      {
        matchId: dueMatchIdOf(1),
        decision: 'votes',
        results: { 'votes-1': 'won', 'votes-2': 'lost' },
      },
      {
        matchId: dueMatchIdOf(2),
        decision: 'last_upvote',
        results: { 'tie-1': 'lost', 'tie-2': 'won' },
      },
      {
        matchId: dueMatchIdOf(3),
        decision: 'last_upvote',
        results: { 'same-1': 'lost', 'same-2': 'won' },
      },
      {
        matchId: dueMatchIdOf(4),
        decision: 'no_votes',
        results: { 'zero-1': 'lost', 'zero-2': 'lost' },
      },
    ]);
  });

  test('マッチごとに別のイベントのIDを採番して書き込みへ渡す', async () => {
    const store = createFakeSettlementStore(dueMatches(3));
    const { settlement } = settlementOf(store);

    await settlement.settleDue(SETTLEMENT_NOW);

    const eventIds = store.writes.flatMap((write) =>
      write.outcomes.map((item) => item.eventId),
    );
    expect(new Set(eventIds).size).toBe(3);
  });

  test('確定したマッチのイベントだけを、書き込みの50マッチごとに送る', async () => {
    const decidedConcurrently = new Set([dueMatchIdOf(2), dueMatchIdOf(51)]);
    const store = createFakeSettlementStore(dueMatches(120), {
      decidedConcurrently,
    });
    const { settlement, dispatcher } = settlementOf(store);

    const summary = await settlement.settleDue(SETTLEMENT_NOW);

    expect(summary).toEqual({ settled: 118, truncated: false });
    expect(store.writes.map((write) => write.outcomes.length)).toEqual([
      50, 50, 20,
    ]);
    expect(dispatcher.published.map((ids) => ids.length)).toEqual([49, 49, 20]);
    const sent = new Set(dispatcher.published.flat());
    const sentMatchIds = store.writes
      .flatMap((write) => write.outcomes)
      .filter((item) => sent.has(item.eventId))
      .map((item) => item.matchId);
    expect(sentMatchIds).not.toContain(dueMatchIdOf(2));
    expect(sentMatchIds).not.toContain(dueMatchIdOf(51));
    expect(sentMatchIds).toHaveLength(118);
  });

  test('書き込みで確定したマッチが無ければ送らない', async () => {
    const due = dueMatches(2);
    const store = createFakeSettlementStore(due, {
      decidedConcurrently: new Set(due.map((match) => match.matchId)),
    });
    const { settlement, dispatcher } = settlementOf(store);

    expect(await settlement.settleDue(SETTLEMENT_NOW)).toEqual({
      settled: 0,
      truncated: false,
    });
    expect(store.writes).toHaveLength(1);
    expect(dispatcher.published).toEqual([]);
  });

  test('打ち切りの時刻を渡すと100件の読み取りの前ごとに時計と比べ、過ぎていれば残りを残してtruncatedを返し、warnのログに件数だけを出す', async () => {
    const store = createFakeSettlementStore(dueMatches(250));
    const clock = createSteppingClock([BEFORE_DEADLINE, DEADLINE]);
    const { settlement } = settlementOf(store, clock);

    const summary = await settlement.settleDue(SETTLEMENT_NOW, DEADLINE);

    expect(summary).toEqual({ settled: 100, truncated: true });
    expect(clock.calls()).toBe(2);
    expect(store.reads).toHaveLength(1);
    expect(store.writes.map((write) => write.outcomes.length)).toEqual([
      50, 50,
    ]);
    expect(matchLogs()).toEqual([
      { level: 'warning', properties: { settled: 100 } },
    ]);
  });

  test('最初の読み取りの前に打ち切りの時刻を過ぎていれば、何も読まずにtruncatedを返す', async () => {
    const store = createFakeSettlementStore(dueMatches(3));
    const clock = createSteppingClock([new Date(DEADLINE.getTime() + 60_000)]);
    const { settlement } = settlementOf(store, clock);

    expect(await settlement.settleDue(SETTLEMENT_NOW, DEADLINE)).toEqual({
      settled: 0,
      truncated: true,
    });
    expect(store.reads).toEqual([]);
    expect(store.writes).toEqual([]);
  });

  test('打ち切りの時刻の前に無くなれば、打ち切らずに終える', async () => {
    const store = createFakeSettlementStore(dueMatches(150));
    const clock = createSteppingClock([BEFORE_DEADLINE]);
    const { settlement } = settlementOf(store, clock);

    expect(await settlement.settleDue(SETTLEMENT_NOW, DEADLINE)).toEqual({
      settled: 150,
      truncated: false,
    });
    expect(clock.calls()).toBe(2);
    expect(matchLogs()).toEqual([]);
  });

  test('打ち切りの時刻を渡さなければ時計を読まず、打ち切らない', async () => {
    const store = createFakeSettlementStore(dueMatches(420));
    const { settlement } = settlementOf(store, unusedClock);

    expect(await settlement.settleDue(SETTLEMENT_NOW)).toEqual({
      settled: 420,
      truncated: false,
    });
    expect(store.reads).toHaveLength(5);
  });

  test('決着を決められないマッチはマッチのIDだけをwarnのログに出して除き、他のマッチを確定する', async () => {
    const single = dueMatchOf(1, [tallyOf('single-1', 4, null, null)]);
    const inconsistent = dueMatchOf(2, [
      tallyOf('broken-1', 2, null, null),
      tallyOf('broken-2', 2, null, null),
    ]);
    const store = createFakeSettlementStore([
      single,
      inconsistent,
      dueMatchOf(3),
    ]);
    const { settlement } = settlementOf(store);

    expect(await settlement.settleDue(SETTLEMENT_NOW)).toEqual({
      settled: 1,
      truncated: false,
    });
    expect(
      store.writes.flatMap((write) =>
        write.outcomes.map((item) => item.matchId),
      ),
    ).toEqual([dueMatchIdOf(3)]);
    expect(matchLogs()).toEqual([
      {
        level: 'warning',
        properties: { matchId: dueMatchIdOf(1), entryCount: 1 },
      },
      {
        level: 'warning',
        properties: { matchId: dueMatchIdOf(2), error: expect.any(RangeError) },
      },
    ]);
  });

  test('決着を決められないマッチが100件以上残っても、同じマッチを読み直し続けずに終える', async () => {
    const broken = Array.from({ length: 120 }, (_, index) =>
      dueMatchOf(index + 1, [tallyOf(`only-${String(index)}`, 0)]),
    );
    const store = createFakeSettlementStore(broken);
    const { settlement } = settlementOf(store);

    expect(await settlement.settleDue(SETTLEMENT_NOW)).toEqual({
      settled: 0,
      truncated: false,
    });
    expect(store.reads).toHaveLength(2);
    expect(store.writes).toEqual([]);
  });
});
