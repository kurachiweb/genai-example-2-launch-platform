import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import type {
  MatchEvent,
  MatchEventType,
} from '../../../lib/core/match/match-events.ts';
import type { MatchKind } from '../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchEntryRecord,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import type { WeekEntryRegistrar } from '../../../lib/core/week-tournament/ports.ts';
import { QualifierEntryHandler } from './qualifier-entry-handler.ts';

const NOW = new Date('2026-11-20T07:41:30.000Z');

const STARTS_AT = new Date('2026-11-19T08:00:00.000Z');

const ENDS_AT = new Date('2026-11-20T07:40:00.000Z');

const DECIDED_AT = new Date('2026-11-20T07:40:05.000Z');

const MATCH_ID = '01JD0MTCH00000000000000001';

const EVENT_ID = '01JD0MEVT00000000000000010';

const ENTRY_ID = '01JD0WENT00000000000000001';

const clock: Clock = { now: () => NOW };

function eventOf(
  type: MatchEventType = 'decided',
  kind: MatchKind = 'qualifier',
): MatchEvent {
  return Object.freeze({
    id: EVENT_ID,
    matchId: MATCH_ID,
    kind,
    type,
    occurredAt: DECIDED_AT,
  });
}

function entryOf(slot: 1 | 2, won: boolean): MatchEntryRecord {
  return {
    entryId: `01JD0ENTR0000000000000000${String(slot)}`,
    slot,
    launchId: `01JD01NCH0000000000000000${String(slot)}`,
    productId: `01JD0PR0D0000000000000000${String(slot)}`,
    ownerUserId: `01JD0USER0000000000000000${String(slot)}`,
    upvoteCount: won ? 12 : 3,
    lastUpvotedAt: null,
    lastUpvoteElapsedMs: won ? 3_600_000 : null,
    forfeited: false,
    result: won ? 'won' : 'lost',
  };
}

function matchOf(columns: Partial<MatchRecord> = {}): MatchRecord {
  return {
    matchId: MATCH_ID,
    kind: 'qualifier',
    round: null,
    stage: null,
    matchDate: parseBusinessDate('2026-11-19'),
    decision: 'votes',
    endedEarly: false,
    phase: 'finished',
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    startedAt: STARTS_AT,
    decidedAt: DECIDED_AT,
    entries: [entryOf(1, true), entryOf(2, false)],
    ...columns,
  };
}

function notUsed(): never {
  throw new Error('予選の枠の作成の処理はこの操作を使わない');
}

interface Harness {
  readonly handler: QualifierEntryHandler;
  readonly lookups: {
    readonly matchIds: readonly string[];
    readonly now: Date;
  }[];
  readonly registrations: { readonly match: MatchRecord; readonly at: Date }[];
}

function createHarness(
  match: MatchRecord | undefined,
  failure?: { readonly on: 'lookup' | 'register'; readonly error: Error },
): Harness {
  const lookups: Harness['lookups'] = [];
  const registrations: Harness['registrations'] = [];
  const directory: MatchDirectory = {
    findMatches: (matchIds, now) => {
      lookups.push({ matchIds, now });
      if (failure?.on === 'lookup') {
        return Promise.reject(failure.error);
      }
      return Promise.resolve(
        new Map(match === undefined ? [] : [[match.matchId, match]]),
      );
    },
    listForDate: notUsed,
    listByLaunches: notUsed,
    findQualifierResults: notUsed,
    summarizeDaily: notUsed,
  };
  const registrar: WeekEntryRegistrar = {
    registerFromMatch: (registered, at) => {
      registrations.push({ match: registered, at });
      return failure?.on === 'register'
        ? Promise.reject(failure.error)
        : Promise.resolve([ENTRY_ID]);
    },
  };
  return {
    handler: new QualifierEntryHandler(directory, registrar, clock),
    lookups,
    registrations,
  };
}

const records: LogRecord[] = [];

beforeAll(() => {
  configureSync({
    reset: true,
    sinks: { capture: (record) => records.push(record) },
    loggers: [
      { category: ['event'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterAll(() => {
  resetSync();
});

beforeEach(() => {
  records.length = 0;
});

function warnings(): LogRecord[] {
  return records.filter(
    (record) =>
      record.category.join('.') === 'event.application.week-tournament' &&
      record.level === 'warning',
  );
}

describe('予選の確定による参加の枠の作成の処理', () => {
  test('確定したマッチを処理の時刻で照会し、読んだ記録のまま処理の時刻で枠の作成を呼んで完了する', async () => {
    const match = matchOf();
    const harness = createHarness(match);

    const outcome = await harness.handler.handle(eventOf());

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.lookups).toStrictEqual([{ matchIds: [MATCH_ID], now: NOW }]);
    expect(harness.registrations).toHaveLength(1);
    expect(harness.registrations[0]?.match).toBe(match);
    expect(harness.registrations[0]?.at).toBe(NOW);
    expect(warnings()).toStrictEqual([]);
  });

  test('勝った側の判定を枠の作成の部品に任せ、両者敗北のマッチも渡して完了する', async () => {
    const match = matchOf({
      decision: 'no_votes',
      entries: [entryOf(1, false), entryOf(2, false)],
    });
    const harness = createHarness(match);

    expect(await harness.handler.handle(eventOf())).toStrictEqual({
      kind: 'done',
    });
    expect(harness.registrations.map((call) => call.match)).toStrictEqual([
      match,
    ]);
  });

  test.each([
    ['予定', 'scheduled', 'qualifier'],
    ['開始', 'started', 'qualifier'],
    ['Weekのトーナメントの確定', 'decided', 'week'],
    ['Yearのトーナメントの確定', 'decided', 'year'],
  ] as const)(
    '%sのイベントではマッチを照会せず枠も作らずに完了する',
    async (_, type, kind) => {
      const harness = createHarness(matchOf());

      expect(await harness.handler.handle(eventOf(type, kind))).toStrictEqual({
        kind: 'done',
      });
      expect(harness.lookups).toStrictEqual([]);
      expect(harness.registrations).toStrictEqual([]);
    },
  );

  test.each([
    ['見つからない', undefined],
    [
      '確定していない',
      matchOf({ decidedAt: null, decision: null, phase: 'tallying' }),
    ],
  ] as const)(
    'マッチが%s場合は、識別子だけの警告のログを出して枠を作らずに完了する',
    async (_, match) => {
      const harness = createHarness(match);

      expect(await harness.handler.handle(eventOf())).toStrictEqual({
        kind: 'done',
      });
      expect(harness.registrations).toStrictEqual([]);
      expect(warnings().map((record) => record.properties)).toStrictEqual([
        { eventId: EVENT_ID, matchId: MATCH_ID, outcome: 'match-not-decided' },
      ]);
    },
  );

  test.each(['lookup', 'register'] as const)(
    '%sの失敗は捕まえずに投げ、メッセージの再試行に任せる',
    async (on) => {
      const error = new Error('D1 unavailable');
      const harness = createHarness(matchOf(), { on, error });

      const caught = await harness.handler
        .handle(eventOf())
        .catch((thrown: unknown) => thrown);

      expect(caught).toBe(error);
      expect(harness.registrations).toHaveLength(on === 'lookup' ? 0 : 1);
    },
  );
});
