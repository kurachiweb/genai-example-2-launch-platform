import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { redactByField } from '@logtape/redaction';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  REDACTED,
  REDACTED_FIELD_PATTERNS,
} from '../../../lib/core/logging/redaction.ts';
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
import type {
  LaunchOutcomeRecorder,
  OutcomeEntry,
  OutcomeRecordResult,
} from '../../../lib/core/product/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import { QualifierOutcomeHandler } from './qualifier-outcome-handler.ts';

const NOW = new Date('2026-11-20T14:41:30.000Z');

const STARTS_AT = new Date('2026-11-19T15:00:00.000Z');

const ENDS_AT = new Date('2026-11-20T14:40:00.000Z');

const DECIDED_AT = new Date('2026-11-20T14:40:05.000Z');

const MATCH_ID = '01JD0MTCH00000000000000001';

const EVENT_ID = '01JD0MEVT00000000000000010';

const LAUNCH_A = '01JD0LNCH00000000000000001';

const LAUNCH_B = '01JD0LNCH00000000000000002';

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

function entryOf(
  slot: 1 | 2,
  launchId: string | null,
  result: EntryResult | null,
): MatchEntryRecord {
  return {
    entryId: `01JD0ENTR0000000000000000${String(slot)}`,
    slot,
    launchId,
    productId:
      launchId === null ? null : `01JD0PROD0000000000000000${String(slot)}`,
    ownerUserId:
      launchId === null ? null : `01JD0USER0000000000000000${String(slot)}`,
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
  throw new Error('結果の記録の処理はこの操作を使わない');
}

interface Harness {
  readonly handler: QualifierOutcomeHandler;
  readonly lookups: {
    readonly matchIds: readonly string[];
    readonly now: Date;
  }[];
  readonly recorded: (readonly OutcomeEntry[])[];
}

function createHarness(
  match: MatchRecord | undefined,
  results: Readonly<Record<string, OutcomeRecordResult>> = {},
  failure?: Error,
): Harness {
  const lookups: {
    readonly matchIds: readonly string[];
    readonly now: Date;
  }[] = [];
  const recorded: (readonly OutcomeEntry[])[] = [];
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
  const recorder: LaunchOutcomeRecorder = {
    record: (entries) => {
      recorded.push(entries);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      return Promise.resolve(
        new Map(
          entries.map((entry) => [
            entry.launchId,
            results[entry.launchId] ?? 'recorded',
          ]),
        ),
      );
    },
  };
  return {
    handler: new QualifierOutcomeHandler(directory, recorder, clock),
    lookups,
    recorded,
  };
}

const records: LogRecord[] = [];

beforeAll(() => {
  configureSync({
    reset: true,
    sinks: {
      capture: redactByField((record) => records.push(record), {
        fieldPatterns: REDACTED_FIELD_PATTERNS,
        action: () => REDACTED,
      }),
    },
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
      record.category.join('.') === 'event.match.events' &&
      record.level === 'warning',
  );
}

describe('予選の結果の記録の処理', () => {
  test('確定した予選の各側のローンチへ、勝利をwon・敗北をlostとして確定の日時とともに記録させて完了する', async () => {
    const harness = createHarness(
      matchOf([entryOf(1, LAUNCH_A, 'won'), entryOf(2, LAUNCH_B, 'lost')]),
    );

    const outcome = await harness.handler.handle(eventOf());

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.lookups).toStrictEqual([{ matchIds: [MATCH_ID], now: NOW }]);
    expect(harness.recorded).toStrictEqual([
      [
        { launchId: LAUNCH_A, outcome: 'won', decidedAt: DECIDED_AT },
        { launchId: LAUNCH_B, outcome: 'lost', decidedAt: DECIDED_AT },
      ],
    ]);
    expect(warnings()).toStrictEqual([]);
  });

  test('不戦勝は勝利として記録させる', async () => {
    const harness = createHarness(
      matchOf([entryOf(1, LAUNCH_A, 'bye')], { decision: 'bye' }),
    );

    await harness.handler.handle(eventOf());

    expect(harness.recorded).toStrictEqual([
      [{ launchId: LAUNCH_A, outcome: 'won', decidedAt: DECIDED_AT }],
    ]);
  });

  test('相手の退会等による勝利は勝利、該当した側は敗北として記録させる', async () => {
    const harness = createHarness(
      matchOf(
        [entryOf(1, LAUNCH_A, 'lost'), entryOf(2, LAUNCH_B, 'walkover')],
        {
          decision: 'walkover',
          endedEarly: true,
        },
      ),
    );

    await harness.handler.handle(eventOf());

    expect(harness.recorded).toStrictEqual([
      [
        { launchId: LAUNCH_A, outcome: 'lost', decidedAt: DECIDED_AT },
        { launchId: LAUNCH_B, outcome: 'won', decidedAt: DECIDED_AT },
      ],
    ]);
  });

  test('両者敗北は両方のローンチを敗北として記録させる', async () => {
    const harness = createHarness(
      matchOf([entryOf(1, LAUNCH_A, 'lost'), entryOf(2, LAUNCH_B, 'lost')], {
        decision: 'no_votes',
      }),
    );

    await harness.handler.handle(eventOf());

    expect(harness.recorded).toStrictEqual([
      [
        { launchId: LAUNCH_A, outcome: 'lost', decidedAt: DECIDED_AT },
        { launchId: LAUNCH_B, outcome: 'lost', decidedAt: DECIDED_AT },
      ],
    ]);
  });

  test('紐付けの解除された側を除いて記録させる', async () => {
    const harness = createHarness(
      matchOf([entryOf(1, null, 'won'), entryOf(2, LAUNCH_B, 'lost')]),
    );

    expect(await harness.handler.handle(eventOf())).toStrictEqual({
      kind: 'done',
    });
    expect(harness.recorded).toStrictEqual([
      [{ launchId: LAUNCH_B, outcome: 'lost', decidedAt: DECIDED_AT }],
    ]);
  });

  test('全ての側の紐付けが解除されていれば、記録させずに完了する', async () => {
    const harness = createHarness(
      matchOf([entryOf(1, null, 'won'), entryOf(2, null, 'lost')]),
    );

    expect(await harness.handler.handle(eventOf())).toStrictEqual({
      kind: 'done',
    });
    expect(harness.recorded).toStrictEqual([]);
    expect(warnings()).toStrictEqual([]);
  });

  test.each(['not-recordable', 'already-recorded'] as const)(
    '記録の結果が%sのローンチがあっても、警告せずに成功として完了する',
    async (result) => {
      const harness = createHarness(
        matchOf([entryOf(1, LAUNCH_A, 'won'), entryOf(2, LAUNCH_B, 'lost')]),
        { [LAUNCH_A]: result },
      );

      expect(await harness.handler.handle(eventOf())).toStrictEqual({
        kind: 'done',
      });
      expect(warnings()).toStrictEqual([]);
    },
  );

  test('異なる結果が既に記録されたローンチは、識別子だけの警告のログを出して成功として完了する', async () => {
    const harness = createHarness(
      matchOf([entryOf(1, LAUNCH_A, 'won'), entryOf(2, LAUNCH_B, 'lost')]),
      { [LAUNCH_B]: 'conflict' },
    );

    expect(await harness.handler.handle(eventOf())).toStrictEqual({
      kind: 'done',
    });
    expect(warnings().map((record) => record.properties)).toStrictEqual([
      {
        eventId: EVENT_ID,
        matchId: MATCH_ID,
        launchId: LAUNCH_B,
        qualifierOutcome: 'lost',
        outcome: 'conflict',
      },
    ]);
  });

  test.each([
    ['started', 'qualifier'],
    ['scheduled', 'qualifier'],
    ['decided', 'week'],
    ['decided', 'year'],
  ] as const)(
    '予選の確定以外(%s・%s)のイベントでは、マッチを読まずに完了する',
    async (type, kind) => {
      const harness = createHarness(
        matchOf([entryOf(1, LAUNCH_A, 'won'), entryOf(2, LAUNCH_B, 'lost')]),
      );

      expect(await harness.handler.handle(eventOf(type, kind))).toStrictEqual({
        kind: 'done',
      });
      expect(harness.lookups).toStrictEqual([]);
      expect(harness.recorded).toStrictEqual([]);
    },
  );

  test('マッチが見つからなければ、警告のログを出して記録させずに完了する', async () => {
    const harness = createHarness(undefined);

    expect(await harness.handler.handle(eventOf())).toStrictEqual({
      kind: 'done',
    });
    expect(harness.recorded).toStrictEqual([]);
    expect(warnings().map((record) => record.properties)).toStrictEqual([
      { eventId: EVENT_ID, matchId: MATCH_ID, outcome: 'match-not-decided' },
    ]);
  });

  test('マッチが未確定なら、警告のログを出して記録させずに完了する', async () => {
    const harness = createHarness(
      matchOf([entryOf(1, LAUNCH_A, null), entryOf(2, LAUNCH_B, null)], {
        decidedAt: null,
        decision: null,
        phase: 'live',
      }),
    );

    expect(await harness.handler.handle(eventOf())).toStrictEqual({
      kind: 'done',
    });
    expect(harness.recorded).toStrictEqual([]);
    expect(warnings().map((record) => record.properties)).toStrictEqual([
      { eventId: EVENT_ID, matchId: MATCH_ID, outcome: 'match-not-decided' },
    ]);
  });

  test('記録の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1の一時的な障害');
    const harness = createHarness(
      matchOf([entryOf(1, LAUNCH_A, 'won'), entryOf(2, LAUNCH_B, 'lost')]),
      {},
      failure,
    );

    const caught = await harness.handler
      .handle(eventOf())
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
  });
});
