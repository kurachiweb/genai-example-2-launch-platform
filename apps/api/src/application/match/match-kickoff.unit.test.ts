import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import {
  MATCH_KICKOFF_LATE_AFTER_MS,
  MATCH_KICKOFF_READ_LIMIT,
  MATCH_KICKOFF_WRITE_LIMIT,
  StoreMatchKickoff,
} from './match-kickoff.ts';
import type { DueKickoff, KickoffWrite } from './ports.ts';
import {
  afterKickoff,
  createFakeEntryEligibilityChecker,
  createFakeKickoffStore,
  createRecordingMatchIncidentReporter,
  dueKickoffOf,
  JUST_BEFORE_KICKOFF,
  KICKOFF_AT,
  kickoffEntryOf,
  kickoffMatchIdOf,
} from './testing/kickoff-fakes.ts';
import {
  createRecordingMatchEventDispatcher,
  createSettlementIds,
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

function dueKickoffs(count: number): DueKickoff[] {
  return Array.from({ length: count }, (_, index) => dueKickoffOf(index + 1));
}

function kickoffOf(
  store: ReturnType<typeof createFakeKickoffStore>,
  eligibility = createFakeEntryEligibilityChecker(),
) {
  const dispatcher = createRecordingMatchEventDispatcher();
  const reporter = createRecordingMatchIncidentReporter();
  const kickoff = new StoreMatchKickoff(
    store,
    eligibility,
    dispatcher,
    reporter,
    createSettlementIds(),
  );
  return { kickoff, dispatcher, reporter, eligibility };
}

function writtenItems(store: ReturnType<typeof createFakeKickoffStore>) {
  return store.writes.flatMap(({ items }) => items);
}

function itemOf(
  store: ReturnType<typeof createFakeKickoffStore>,
  matchIndex: number,
): KickoffWrite | undefined {
  return writtenItems(store).find(
    (item) => item.matchId === kickoffMatchIdOf(matchIndex),
  );
}

describe('StoreMatchKickoff.kickoffDue(開始の日時の境界)', () => {
  test('開始の日時の直前(前日の23:59:59)の実行では開始せず、0:00の実行で開始する', async () => {
    const store = createFakeKickoffStore(dueKickoffs(1));
    const { kickoff, dispatcher } = kickoffOf(store);

    const before = await kickoff.kickoffDue(JUST_BEFORE_KICKOFF);

    expect(before).toEqual({ started: 0, decided: 0 });
    expect(store.reads).toEqual([
      { now: JUST_BEFORE_KICKOFF, limit: MATCH_KICKOFF_READ_LIMIT },
    ]);
    expect(store.writes).toEqual([]);

    const atKickoff = await kickoff.kickoffDue(KICKOFF_AT);

    expect(atKickoff).toEqual({ started: 1, decided: 0 });
    expect(store.writes).toEqual([
      {
        items: [
          {
            matchId: kickoffMatchIdOf(1),
            outcome: { kind: 'start' },
            eventId: expect.any(String) as string,
            forfeitedEntryIds: [],
          },
        ],
        at: KICKOFF_AT,
      },
    ]);
    expect(dispatcher.published).toEqual([
      [store.writes[0]?.items[0]?.eventId ?? ''],
    ]);
  });
});

describe('StoreMatchKickoff.kickoffDue(読み取りと書き込みの単位)', () => {
  test('開始の日時を過ぎた未開始のマッチを100件ずつ無くなるまで読み、50マッチずつ書き込んで書き込みごとにイベントを送る', async () => {
    const store = createFakeKickoffStore(dueKickoffs(230));
    const { kickoff, dispatcher } = kickoffOf(store);

    const summary = await kickoff.kickoffDue(KICKOFF_AT);

    expect(summary).toEqual({ started: 230, decided: 0 });
    expect(store.reads.map(({ limit }) => limit)).toEqual([
      MATCH_KICKOFF_READ_LIMIT,
      MATCH_KICKOFF_READ_LIMIT,
      MATCH_KICKOFF_READ_LIMIT,
    ]);
    expect(store.writes.map(({ items }) => items.length)).toEqual([
      50, 50, 50, 50, 30,
    ]);
    expect(
      store.writes.every(
        ({ items }) => items.length <= MATCH_KICKOFF_WRITE_LIMIT,
      ),
    ).toBe(true);
    expect(dispatcher.published.map((page) => page.length)).toEqual([
      50, 50, 50, 50, 30,
    ]);
    expect(new Set(writtenItems(store).map((item) => item.eventId)).size).toBe(
      230,
    );
  });

  test('読み取りごとに、該当の判定へその読み取りのマッチの種別と側と実行時刻を渡す', async () => {
    const store = createFakeKickoffStore(dueKickoffs(2));
    const eligibility = createFakeEntryEligibilityChecker();
    const { kickoff } = kickoffOf(store, eligibility);

    await kickoff.kickoffDue(KICKOFF_AT);

    expect(
      eligibility.calls.map(({ items, now }) => ({
        items: items.map(({ kind, entries }) => ({ kind, entries })),
        now,
      })),
    ).toEqual([
      {
        items: dueKickoffs(2).map(({ kind, entries }) => ({ kind, entries })),
        now: KICKOFF_AT,
      },
    ]);
  });

  test('開始の日時を過ぎた未開始のマッチが無ければ、判定も書き込みも送信もしない', async () => {
    const store = createFakeKickoffStore([]);
    const eligibility = createFakeEntryEligibilityChecker();
    const { kickoff, dispatcher, reporter } = kickoffOf(store, eligibility);

    const summary = await kickoff.kickoffDue(KICKOFF_AT);

    expect(summary).toEqual({ started: 0, decided: 0 });
    expect(eligibility.calls).toEqual([]);
    expect(store.writes).toEqual([]);
    expect(dispatcher.published).toEqual([]);
    expect(reporter.incidents).toEqual([]);
  });
});

describe('StoreMatchKickoff.kickoffDue(開始時点の決着)', () => {
  test('該当の判定の結果で、開始・不戦勝・相手の退会等による勝利・両者敗北に分ける', async () => {
    const due = [
      dueKickoffOf(1),
      dueKickoffOf(2, [kickoffEntryOf(2, 1)]),
      dueKickoffOf(3, [
        kickoffEntryOf(3, 1, { forfeited: true }),
        kickoffEntryOf(3, 2),
      ]),
      dueKickoffOf(4, [kickoffEntryOf(4, 1), kickoffEntryOf(4, 2)]),
      dueKickoffOf(5, [
        kickoffEntryOf(5, 1, { forfeited: true }),
        kickoffEntryOf(5, 2),
      ]),
      dueKickoffOf(6, [kickoffEntryOf(6, 1, { forfeited: true })]),
    ];
    const store = createFakeKickoffStore(due);
    const eligibility = createFakeEntryEligibilityChecker(
      new Set([kickoffEntryOf(4, 2).entryId, kickoffEntryOf(5, 2).entryId]),
    );
    const { kickoff } = kickoffOf(store, eligibility);

    const summary = await kickoff.kickoffDue(KICKOFF_AT);

    expect(summary).toEqual({ started: 1, decided: 5 });
    const entry = (matchIndex: number, slot: 1 | 2) =>
      kickoffEntryOf(matchIndex, slot).entryId;
    expect(itemOf(store, 1)).toMatchObject({
      outcome: { kind: 'start' },
      forfeitedEntryIds: [],
    });
    expect(itemOf(store, 2)).toMatchObject({
      outcome: {
        kind: 'decided',
        outcome: { decision: 'bye', results: new Map([[entry(2, 1), 'bye']]) },
      },
      forfeitedEntryIds: [],
    });
    expect(itemOf(store, 3)).toMatchObject({
      outcome: {
        kind: 'decided',
        outcome: {
          decision: 'walkover',
          results: new Map([
            [entry(3, 1), 'lost'],
            [entry(3, 2), 'walkover'],
          ]),
        },
      },
      forfeitedEntryIds: [entry(3, 1)],
    });
    expect(itemOf(store, 4)).toMatchObject({
      outcome: {
        kind: 'decided',
        outcome: {
          decision: 'walkover',
          results: new Map([
            [entry(4, 1), 'walkover'],
            [entry(4, 2), 'lost'],
          ]),
        },
      },
      forfeitedEntryIds: [entry(4, 2)],
    });
    expect(itemOf(store, 5)).toMatchObject({
      outcome: {
        kind: 'decided',
        outcome: {
          decision: 'both_forfeited',
          results: new Map([
            [entry(5, 1), 'lost'],
            [entry(5, 2), 'lost'],
          ]),
        },
      },
      forfeitedEntryIds: [entry(5, 1), entry(5, 2)],
    });
    expect(itemOf(store, 6)).toMatchObject({
      outcome: {
        kind: 'decided',
        outcome: {
          decision: 'both_forfeited',
          results: new Map([[entry(6, 1), 'lost']]),
        },
      },
      forfeitedEntryIds: [entry(6, 1)],
    });
  });

  test('側の数が不正で決着を決められないマッチは、マッチのIDと側の数だけをwarnのログに出して除き、他のマッチを開始する', async () => {
    const broken = dueKickoffOf(1, []);
    const store = createFakeKickoffStore([broken, dueKickoffOf(2)]);
    const { kickoff } = kickoffOf(store);

    const summary = await kickoff.kickoffDue(KICKOFF_AT);

    expect(summary).toEqual({ started: 1, decided: 0 });
    expect(writtenItems(store).map((item) => item.matchId)).toEqual([
      kickoffMatchIdOf(2),
    ]);
    expect(store.reads).toHaveLength(1);
    expect(matchLogs()).toEqual([
      {
        level: 'warning',
        properties: { matchId: kickoffMatchIdOf(1), entryCount: 0 },
      },
    ]);
  });
});

describe('StoreMatchKickoff.kickoffDue(再実行と同時の書き込み)', () => {
  test('2回実行しても、同じマッチを重複して開始・確定せずイベントも送らない', async () => {
    const store = createFakeKickoffStore(dueKickoffs(3));
    const { kickoff, dispatcher } = kickoffOf(store);

    await kickoff.kickoffDue(KICKOFF_AT);
    const second = await kickoff.kickoffDue(afterKickoff(60_000));

    expect(second).toEqual({ started: 0, decided: 0 });
    expect(store.writes).toHaveLength(1);
    expect(dispatcher.published).toHaveLength(1);
  });

  test('読み取りの後に別の実行が先に書いたマッチは数えず、そのイベントを送らない', async () => {
    const store = createFakeKickoffStore(dueKickoffs(2), {
      concurrent: new Set([kickoffMatchIdOf(1)]),
    });
    const { kickoff, dispatcher } = kickoffOf(store);

    const summary = await kickoff.kickoffDue(KICKOFF_AT);

    expect(summary).toEqual({ started: 1, decided: 0 });
    expect(dispatcher.published).toEqual([[itemOf(store, 2)?.eventId ?? '']]);
  });

  test('書き込みを拒まれたマッチ(読み取りの後に該当が記録された)は読み直してもう1回だけ書き込む', async () => {
    const store = createFakeKickoffStore(dueKickoffs(2), {
      refusedOnce: new Set([kickoffMatchIdOf(1)]),
    });
    const { kickoff, dispatcher } = kickoffOf(store);

    const summary = await kickoff.kickoffDue(KICKOFF_AT);

    expect(summary).toEqual({ started: 2, decided: 0 });
    expect(store.reads).toHaveLength(2);
    expect(
      store.writes.map(({ items }) => items.map((i) => i.matchId)),
    ).toEqual([
      [kickoffMatchIdOf(1), kickoffMatchIdOf(2)],
      [kickoffMatchIdOf(1)],
    ]);
    expect(dispatcher.published).toHaveLength(2);
  });

  test('2回とも書き込みを拒まれたマッチは残して終える', async () => {
    const store = createFakeKickoffStore(dueKickoffs(1), {
      refused: new Set([kickoffMatchIdOf(1)]),
    });
    const { kickoff, dispatcher } = kickoffOf(store);

    const summary = await kickoff.kickoffDue(KICKOFF_AT);

    expect(summary).toEqual({ started: 0, decided: 0 });
    expect(store.writes).toHaveLength(2);
    expect(dispatcher.published).toEqual([]);
  });
});

describe('StoreMatchKickoff.kickoffDue(開始の遅れの報告)', () => {
  test('開始の日時からちょうど10分の開始は報告しない', async () => {
    const store = createFakeKickoffStore(dueKickoffs(2));
    const { kickoff, reporter } = kickoffOf(store);

    await kickoff.kickoffDue(afterKickoff(MATCH_KICKOFF_LATE_AFTER_MS));

    expect(reporter.incidents).toEqual([]);
  });

  test('開始の日時から10分を過ぎて開始・決着したマッチがあれば、件数を添えて1回だけ報告する', async () => {
    const store = createFakeKickoffStore([
      dueKickoffOf(1),
      dueKickoffOf(2, [kickoffEntryOf(2, 1)]),
      dueKickoffOf(3, undefined, { startsAt: afterKickoff(60_000) }),
    ]);
    const { kickoff, reporter } = kickoffOf(store);

    await kickoff.kickoffDue(afterKickoff(MATCH_KICKOFF_LATE_AFTER_MS + 1));

    expect(reporter.incidents).toEqual([
      { kind: 'match-kickoff-late', count: 2 },
    ]);
  });

  test('遅れて読んだマッチでも、別の実行が先に書いたものは報告に数えない', async () => {
    const store = createFakeKickoffStore(dueKickoffs(1), {
      concurrent: new Set([kickoffMatchIdOf(1)]),
    });
    const { kickoff, reporter } = kickoffOf(store);

    await kickoff.kickoffDue(afterKickoff(3_600_000));

    expect(reporter.incidents).toEqual([]);
  });
});
