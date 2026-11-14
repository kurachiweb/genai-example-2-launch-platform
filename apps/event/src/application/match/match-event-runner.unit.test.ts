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
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  type LifecycleHandlerOutcome,
} from '../../../lib/core/identity/user-lifecycle.ts';
import {
  REDACTED,
  REDACTED_FIELD_PATTERNS,
} from '../../../lib/core/logging/redaction.ts';
import {
  createMatchEventRegistry,
  type MatchEvent,
  type MatchEventHandler,
  type MatchEventRegistration,
  type MatchEventType,
} from '../../../lib/core/match/match-events.ts';
import type { MatchKind } from '../../../lib/core/match/match-model.ts';
import type {
  MatchEventStore,
  StoredMatchEvent,
} from '../../../lib/core/match/ports.ts';
import type { RunMatchEventBody } from '../../../lib/core/messaging/contracts/match.ts';
import type {
  MessageHandler,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import {
  MATCH_EVENT_ORDER_WAIT_SECONDS,
  MatchEventRunner,
} from './match-event-runner.ts';
import type { MatchEventHandlerResolver } from './ports.ts';

const NOW = new Date('2026-11-20T15:00:30.000Z');

const MATCH_ID = '01JD0MTCH00000000000000001';

const EVENT_ID = '01JD0MEVT00000000000000010';

const EARLIER_EVENT_ID = '01JD0MEVT00000000000000009';

const META: MessageMeta = {
  id: 'message-1',
  type: 'match.run-match-event',
  attempts: 1,
  sentAt: new Date('2026-11-20T15:00:10.000Z'),
};

function storedEvent(
  columns: Partial<StoredMatchEvent> = {},
): StoredMatchEvent {
  return {
    id: EVENT_ID,
    matchId: MATCH_ID,
    kind: 'qualifier',
    type: 'decided',
    occurredAt: new Date('2026-11-20T15:00:00.000Z'),
    status: 'pending',
    dispatchCount: 1,
    lastDispatchedAt: new Date('2026-11-20T15:00:00.000Z'),
    ...columns,
  };
}

type Call =
  | { readonly kind: 'handler'; readonly name: string }
  | {
      readonly kind: 'handler-completed';
      readonly name: string;
      readonly at: Date;
    }
  | { readonly kind: 'event-completed'; readonly at: Date };

function notUsed(): never {
  throw new Error('実行器はこの操作を使わない');
}

class FakeMatchEventStore implements MatchEventStore {
  readonly events = new Map<string, StoredMatchEvent>();
  readonly completed = new Map<string, Set<string>>();

  constructor(private readonly calls: Call[]) {}

  findEvent(eventId: string) {
    return Promise.resolve(this.events.get(eventId));
  }

  findOldestPending(matchId: string) {
    const pending = [...this.events.values()]
      .filter(
        (event) => event.matchId === matchId && event.status === 'pending',
      )
      .toSorted(
        (left, right) =>
          left.occurredAt.getTime() - right.occurredAt.getTime() ||
          left.id.localeCompare(right.id),
      );
    return Promise.resolve(pending[0]);
  }

  completedHandlers(eventId: string) {
    return Promise.resolve(
      new Set(this.completed.get(eventId)) as ReadonlySet<string>,
    );
  }

  markHandlerCompleted(eventId: string, handlerName: string, at: Date) {
    this.calls.push({ kind: 'handler-completed', name: handlerName, at });
    const names = this.completed.get(eventId) ?? new Set<string>();
    names.add(handlerName);
    this.completed.set(eventId, names);
    return Promise.resolve();
  }

  markEventCompleted(eventId: string, at: Date) {
    this.calls.push({ kind: 'event-completed', at });
    const event = this.events.get(eventId);
    if (event !== undefined) {
      this.events.set(eventId, { ...event, status: 'completed' });
    }
    return Promise.resolve();
  }

  createMissingDecidedEvents = notUsed;
  listStalePending = notUsed;
  markRedispatched = notUsed;
  deleteCompletedBefore = notUsed;
}

class FakeHandler implements MatchEventHandler {
  readonly received: MatchEvent[] = [];
  outcomes: (LifecycleHandlerOutcome | Error)[] = [];

  constructor(
    private readonly name: string,
    private readonly calls: Call[],
  ) {}

  handle(event: MatchEvent) {
    this.calls.push({ kind: 'handler', name: this.name });
    this.received.push(event);
    const next = this.outcomes.shift() ?? { kind: 'done' };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

interface Harness {
  readonly runner: MessageHandler<RunMatchEventBody>;
  readonly store: FakeMatchEventStore;
  readonly handlers: ReadonlyMap<string, FakeHandler>;
  readonly calls: Call[];
}

function registration(
  name: string,
  order: number,
  events: readonly MatchEventType[] = ['decided'],
  kinds?: readonly MatchKind[],
): MatchEventRegistration {
  return {
    name,
    order,
    events,
    ...(kinds === undefined ? {} : { kinds }),
    handler: Symbol.for(name),
  };
}

// 登録の順と異なる順序の値で並べ替えが効くことを確かめられるよう、後に登録したものほど前に動く
const REGISTRATIONS = [
  registration('tournament-week.bracket-advance', 1500, ['decided'], ['week']),
  registration('notifications.match-result', 1300),
  registration(
    'match-engine.qualifier-outcome',
    1100,
    ['decided'],
    ['qualifier'],
  ),
  registration('directory-discovery.started-sync', 1200, ['started']),
];

function createHarness(
  registrations: readonly MatchEventRegistration[] = REGISTRATIONS,
): Harness {
  const calls: Call[] = [];
  const store = new FakeMatchEventStore(calls);
  const handlers = new Map(
    registrations.map(({ name }) => [name, new FakeHandler(name, calls)]),
  );
  const resolver: MatchEventHandlerResolver = {
    resolve: ({ name }) => {
      const handler = handlers.get(name);
      if (handler === undefined) {
        throw new Error(`未登録の処理: ${name}`);
      }
      return handler;
    },
  };
  const runner = new MatchEventRunner({
    store,
    registry: createMatchEventRegistry(registrations),
    resolver,
    clock: { now: () => NOW },
  });
  return { runner, store, handlers, calls };
}

function handlerOf(harness: Harness, name: string): FakeHandler {
  const handler = harness.handlers.get(name);
  if (handler === undefined) {
    throw new Error(`未登録の処理: ${name}`);
  }
  return handler;
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

function eventLogs(): LogRecord[] {
  return records.filter(
    (record) => record.category.join('.') === 'event.match.events',
  );
}

describe('マッチイベントの実行器', () => {
  test('定数は設計の60秒の待ちを表す', () => {
    expect(MATCH_EVENT_ORDER_WAIT_SECONDS).toBe(60);
  });

  test('存在しないイベントは何もせず終える', async () => {
    const harness = createHarness();

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([]);
    expect(eventLogs().at(-1)?.properties).toStrictEqual({
      eventId: EVENT_ID,
      outcome: 'missing',
    });
  });

  test('完了済みのイベントは処理を呼ばずに終える', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ status: 'completed' }));

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([]);
    expect(eventLogs().at(-1)?.properties).toStrictEqual({
      eventId: EVENT_ID,
      type: 'decided',
      outcome: 'already-completed',
    });
  });

  test('同じマッチのより前のイベントが未完了なら、処理を始めず60秒遅らせる', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    harness.store.events.set(
      EARLIER_EVENT_ID,
      storedEvent({
        id: EARLIER_EVENT_ID,
        type: 'started',
        occurredAt: new Date('2026-11-19T15:00:00.000Z'),
      }),
    );

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({
      kind: 'defer',
      delaySeconds: MATCH_EVENT_ORDER_WAIT_SECONDS,
    });
    expect(harness.calls).toEqual([]);
    expect(eventLogs().at(-1)?.properties).toStrictEqual({
      eventId: EVENT_ID,
      type: 'decided',
      outcome: 'waiting-for-earlier-event',
    });
  });

  test('他のマッチの未完了のイベントは待たない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    harness.store.events.set(
      EARLIER_EVENT_ID,
      storedEvent({
        id: EARLIER_EVENT_ID,
        matchId: '01JD0MTCH00000000000000002',
        occurredAt: new Date('2026-11-19T15:00:00.000Z'),
      }),
    );

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls.at(-1)).toEqual({ kind: 'event-completed', at: NOW });
  });

  test('種類と種別に登録した処理を順序の値の昇順に実行し、1つずつ完了を記録してからイベントを完了にする', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'match-engine.qualifier-outcome' },
      {
        kind: 'handler-completed',
        name: 'match-engine.qualifier-outcome',
        at: NOW,
      },
      { kind: 'handler', name: 'notifications.match-result' },
      {
        kind: 'handler-completed',
        name: 'notifications.match-result',
        at: NOW,
      },
      { kind: 'event-completed', at: NOW },
    ]);
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('completed');
    expect(eventLogs().at(-1)?.properties).toStrictEqual({
      eventId: EVENT_ID,
      type: 'decided',
      outcome: 'completed',
    });
  });

  test('対象の種別を絞った処理は、他の種別のマッチのイベントでは呼ばない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ kind: 'week' }));

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(
      harness.calls.flatMap((call) =>
        call.kind === 'handler' ? [call.name] : [],
      ),
    ).toEqual([
      'notifications.match-result',
      'tournament-week.bracket-advance',
    ]);
  });

  test('処理には記録の状態を除いたイベントを渡す', async () => {
    const harness = createHarness();
    const event = storedEvent();
    harness.store.events.set(EVENT_ID, event);

    await harness.runner.handle({ eventId: EVENT_ID }, META);

    const [received] = handlerOf(
      harness,
      'match-engine.qualifier-outcome',
    ).received;
    expect(received).toStrictEqual({
      id: event.id,
      matchId: event.matchId,
      kind: event.kind,
      type: event.type,
      occurredAt: event.occurredAt,
    });
    expect(Object.isFrozen(received)).toBe(true);
  });

  test('完了を記録済みの処理は呼ばずに飛ばす', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    harness.store.completed.set(
      EVENT_ID,
      new Set(['match-engine.qualifier-outcome']),
    );

    await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'notifications.match-result' },
      {
        kind: 'handler-completed',
        name: 'notifications.match-result',
        at: NOW,
      },
      { kind: 'event-completed', at: NOW },
    ]);
  });

  test('処理が登録されていない種類は、イベントの完了だけを記録する', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'scheduled' }));

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([{ kind: 'event-completed', at: NOW }]);
  });

  test('処理を1つも登録していない登録口でも、イベントの完了だけを記録する', async () => {
    const harness = createHarness([]);
    harness.store.events.set(EVENT_ID, storedEvent());

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([{ kind: 'event-completed', at: NOW }]);
  });

  test('処理を完了するたびに、処理の名前を添えて記録を残す', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());

    await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(
      eventLogs()
        .map((record) => record.properties)
        .filter((properties) => properties['outcome'] === 'handler-completed'),
    ).toStrictEqual([
      {
        eventId: EVENT_ID,
        type: 'decided',
        handler: 'match-engine.qualifier-outcome',
        outcome: 'handler-completed',
      },
      {
        eventId: EVENT_ID,
        type: 'decided',
        handler: 'notifications.match-result',
        outcome: 'handler-completed',
      },
    ]);
  });

  test('処理に続きがあれば、完了を記録せず後の処理も呼ばずに5秒遅らせる', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    handlerOf(harness, 'notifications.match-result').outcomes = [
      { kind: 'continue' },
    ];

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({
      kind: 'defer',
      delaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    expect(LIFECYCLE_CONTINUE_DELAY_SECONDS).toBe(5);
    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'match-engine.qualifier-outcome' },
      {
        kind: 'handler-completed',
        name: 'match-engine.qualifier-outcome',
        at: NOW,
      },
      { kind: 'handler', name: 'notifications.match-result' },
    ]);
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('pending');
    expect(eventLogs().at(-1)?.properties).toStrictEqual({
      eventId: EVENT_ID,
      type: 'decided',
      handler: 'notifications.match-result',
      outcome: 'continued',
    });
  });

  test('続きの再送では、完了した処理を飛ばして続きの処理から再開する', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    handlerOf(harness, 'notifications.match-result').outcomes = [
      { kind: 'continue' },
      { kind: 'done' },
    ];
    await harness.runner.handle({ eventId: EVENT_ID }, META);
    harness.calls.length = 0;

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'notifications.match-result' },
      {
        kind: 'handler-completed',
        name: 'notifications.match-result',
        at: NOW,
      },
      { kind: 'event-completed', at: NOW },
    ]);
  });

  test('処理の例外はそのまま投げ、その処理とイベントの完了を記録しない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    const failure = new Error('処理の一時的な失敗');
    handlerOf(harness, 'notifications.match-result').outcomes = [failure];

    const caught = await harness.runner
      .handle({ eventId: EVENT_ID }, META)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'match-engine.qualifier-outcome' },
      {
        kind: 'handler-completed',
        name: 'match-engine.qualifier-outcome',
        at: NOW,
      },
      { kind: 'handler', name: 'notifications.match-result' },
    ]);
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('pending');
  });

  test('ストアの例外はそのまま投げる', async () => {
    const harness = createHarness();
    const failure = new Error('D1_ERROR: network connection lost');
    harness.store.findEvent = () => Promise.reject(failure);

    const caught = await harness.runner
      .handle({ eventId: EVENT_ID }, META)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
  });
});
