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
  DirectoryEntry,
  DirectoryEntryStore,
} from '../../../lib/core/directory/ports.ts';
import type {
  MatchEvent,
  MatchEventType,
} from '../../../lib/core/match/match-events.ts';
import type {
  EntryResult,
  MatchKind,
} from '../../../lib/core/match/match-model.ts';
import type {
  MatchDirectory,
  MatchEntryRecord,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import type { SearchIndexRefreshRequester } from '../../../lib/core/search/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  PRODUCT_SEARCH_TARGET_NAME,
  type ProductIndexPendingMarker,
} from './ports.ts';
import { QualifierListingHandler } from './qualifier-listing-handler.ts';

const NOW = new Date('2026-11-20T14:41:30.000Z');

const STARTS_AT = new Date('2026-11-19T15:00:00.000Z');

const ENDS_AT = new Date('2026-11-20T14:40:00.000Z');

const DECIDED_AT = new Date('2026-11-20T14:40:05.000Z');

const MATCH_ID = '01JD0MTCH00000000000000001';

const EVENT_ID = '01JD0MEVT00000000000000010';

const clock: Clock = { now: () => NOW };

function productIdOf(slot: 1 | 2): string {
  return `01JD0PROD0000000000000000${String(slot)}`;
}

function ownerIdOf(slot: 1 | 2): string {
  return `01JD0USER0000000000000000${String(slot)}`;
}

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

interface EntryOptions {
  readonly linked?: boolean;
  readonly ownerCleared?: boolean;
}

function entryOf(
  slot: 1 | 2,
  result: EntryResult | null,
  { linked = true, ownerCleared = false }: EntryOptions = {},
): MatchEntryRecord {
  return {
    entryId: `01JD0ENTR0000000000000000${String(slot)}`,
    slot,
    launchId: linked ? `01JD0LNCH0000000000000000${String(slot)}` : null,
    productId: linked ? productIdOf(slot) : null,
    ownerUserId: linked && !ownerCleared ? ownerIdOf(slot) : null,
    upvoteCount: 0,
    lastUpvotedAt: null,
    lastUpvoteElapsedMs: null,
    forfeited: false,
    result,
  };
}

function matchOf(
  entries: readonly MatchEntryRecord[],
  columns: Partial<MatchRecord> = {},
): MatchRecord {
  return {
    matchId: MATCH_ID,
    kind: 'qualifier',
    round: null,
    stage: null,
    matchDate: parseBusinessDate('2026-11-20'),
    decision: 'votes',
    endedEarly: false,
    phase: 'finished',
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    startedAt: STARTS_AT,
    decidedAt: DECIDED_AT,
    entries,
    ...columns,
  };
}

function notUsed(): never {
  throw new Error('掲載の記録の処理はこの操作を使わない');
}

type Call =
  | {
      readonly kind: 'record';
      readonly entries: readonly DirectoryEntry[];
      readonly at: Date;
    }
  | {
      readonly kind: 'mark';
      readonly productIds: readonly string[];
      readonly at: Date;
    }
  | {
      readonly kind: 'refresh';
      readonly target: string;
      readonly sourceId: string;
    };

interface Harness {
  readonly handler: QualifierListingHandler;
  readonly lookups: {
    readonly matchIds: readonly string[];
    readonly now: Date;
  }[];
  readonly calls: Call[];
}

function createHarness(
  match: MatchRecord | undefined,
  failure?: { readonly on: Call['kind']; readonly error: Error },
): Harness {
  const lookups: Harness['lookups'] = [];
  const calls: Call[] = [];
  const settle = (call: Call): Promise<void> => {
    calls.push(call);
    return failure?.on === call.kind
      ? Promise.reject(failure.error)
      : Promise.resolve();
  };
  const directory: MatchDirectory = {
    findMatches: (matchIds, now) => {
      lookups.push({ matchIds, now });
      return Promise.resolve(
        new Map(match === undefined ? [] : [[match.matchId, match]]),
      );
    },
    listForDate: notUsed,
    listByLaunches: notUsed,
    findQualifierResults: notUsed,
    summarizeDaily: notUsed,
  };
  const entries: DirectoryEntryStore = {
    record: (recorded, at) => settle({ kind: 'record', entries: recorded, at }),
    exists: notUsed,
    listProductIdsByOwner: notUsed,
    erase: notUsed,
  };
  const pendingMarker: ProductIndexPendingMarker = {
    mark: (productIds, at) => settle({ kind: 'mark', productIds, at }),
  };
  const requester: SearchIndexRefreshRequester = {
    requestRefresh: (target, sourceId) =>
      settle({ kind: 'refresh', target, sourceId }),
  };
  return {
    handler: new QualifierListingHandler(
      directory,
      entries,
      pendingMarker,
      requester,
      clock,
    ),
    lookups,
    calls,
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
      record.category.join('.') === 'event.application.directory' &&
      record.level === 'warning',
  );
}

function listedCalls(slots: readonly (1 | 2)[]): Call[] {
  return [
    {
      kind: 'record',
      entries: slots.map((slot) => ({
        productId: productIdOf(slot),
        ownerUserId: ownerIdOf(slot),
      })),
      at: DECIDED_AT,
    },
    { kind: 'mark', productIds: slots.map(productIdOf), at: NOW },
    ...slots.map((slot): Call => ({
      kind: 'refresh',
      target: PRODUCT_SEARCH_TARGET_NAME,
      sourceId: productIdOf(slot),
    })),
  ];
}

describe('予選の勝利の確定による掲載の記録の処理', () => {
  test('勝った側のプロダクトだけを確定の日時で記録し、処理の時刻で更新待ちにしてから索引の更新を要求して完了する', async () => {
    const harness = createHarness(
      matchOf([entryOf(1, 'won'), entryOf(2, 'lost')]),
    );

    const outcome = await harness.handler.handle(eventOf());

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.lookups).toStrictEqual([{ matchIds: [MATCH_ID], now: NOW }]);
    expect(harness.calls).toStrictEqual(listedCalls([1]));
    expect(warnings()).toStrictEqual([]);
  });

  test.each([
    ['不戦勝', 'bye'],
    ['相手の退会等による勝利', 'walkover'],
  ] as const)('%sを勝利として扱う', async (_, result) => {
    const harness = createHarness(
      matchOf([entryOf(1, 'lost'), entryOf(2, result)], {
        decision: result,
      }),
    );

    await harness.handler.handle(eventOf());

    expect(harness.calls).toStrictEqual(listedCalls([2]));
  });

  test('両者敗北では何も記録せず、索引の更新も要求せずに完了する', async () => {
    const harness = createHarness(
      matchOf([entryOf(1, 'lost'), entryOf(2, 'lost')], {
        decision: 'no_votes',
      }),
    );

    expect(await harness.handler.handle(eventOf())).toStrictEqual({
      kind: 'done',
    });
    expect(harness.calls).toStrictEqual([]);
  });

  test('結果の無い側を掲載の対象にしない', async () => {
    const harness = createHarness(
      matchOf([entryOf(1, null), entryOf(2, 'won')]),
    );

    await harness.handler.handle(eventOf());

    expect(harness.calls).toStrictEqual(listedCalls([2]));
  });

  test.each([
    ['プロダクトの紐付けが解除された', { linked: false }],
    ['投稿者の紐付けが解除された', { ownerCleared: true }],
  ] as const)(
    '%s勝った側を除き、記録も索引の更新の要求もせずに完了する',
    async (_, options) => {
      const harness = createHarness(
        matchOf([entryOf(1, 'won', options), entryOf(2, 'lost')]),
      );

      expect(await harness.handler.handle(eventOf())).toStrictEqual({
        kind: 'done',
      });
      expect(harness.calls).toStrictEqual([]);
      expect(warnings()).toStrictEqual([]);
    },
  );

  test.each([
    ['予定', 'scheduled', 'qualifier'],
    ['開始', 'started', 'qualifier'],
    ['Weekのトーナメントの確定', 'decided', 'week'],
    ['Yearのトーナメントの確定', 'decided', 'year'],
  ] as const)(
    '%sのイベントではマッチを照会せずに完了する',
    async (_, type, kind) => {
      const harness = createHarness(
        matchOf([entryOf(1, 'won'), entryOf(2, 'lost')]),
      );

      expect(await harness.handler.handle(eventOf(type, kind))).toStrictEqual({
        kind: 'done',
      });
      expect(harness.lookups).toStrictEqual([]);
      expect(harness.calls).toStrictEqual([]);
    },
  );

  test.each([
    ['見つからない', undefined],
    [
      '確定していない',
      matchOf([entryOf(1, null), entryOf(2, null)], {
        decidedAt: null,
        decision: null,
        phase: 'tallying',
      }),
    ],
  ] as const)(
    'マッチが%s場合は、識別子だけの警告のログを出して何も書かずに完了する',
    async (_, match) => {
      const harness = createHarness(match);

      expect(await harness.handler.handle(eventOf())).toStrictEqual({
        kind: 'done',
      });
      expect(harness.calls).toStrictEqual([]);
      expect(warnings().map((record) => record.properties)).toStrictEqual([
        { eventId: EVENT_ID, matchId: MATCH_ID, outcome: 'match-not-decided' },
      ]);
    },
  );

  test.each(['record', 'mark'] as const)(
    '%sの失敗は捕まえずに投げ、後の書き込みと索引の更新の要求をしない',
    async (on) => {
      const error = new Error('D1 unavailable');
      const harness = createHarness(
        matchOf([entryOf(1, 'won'), entryOf(2, 'lost')]),
        { on, error },
      );

      const caught = await harness.handler
        .handle(eventOf())
        .catch((thrown: unknown) => thrown);

      expect(caught).toBe(error);
      expect(harness.calls.at(-1)?.kind).toBe(on);
      expect(harness.calls.some(({ kind }) => kind === 'refresh')).toBe(false);
    },
  );
});
