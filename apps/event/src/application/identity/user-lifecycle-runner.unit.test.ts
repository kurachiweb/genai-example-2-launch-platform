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

import type {
  StoredLifecycleEvent,
  UserLifecycleStore,
} from '../../../lib/core/identity/ports.ts';
import {
  createAsyncLifecycleRegistry,
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  type LifecycleHandlerOutcome,
  type UserLifecycleAsyncHandler,
  type UserLifecycleAsyncRegistration,
  type UserLifecycleEvent,
  type UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import {
  REDACTED,
  REDACTED_FIELD_PATTERNS,
} from '../../../lib/core/logging/redaction.ts';
import type { RunUserLifecycleBody } from '../../../lib/core/messaging/contracts/identity.ts';
import type {
  MessageHandler,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import type { IdentityPurgeStore, LifecycleHandlerResolver } from './ports.ts';
import {
  LIFECYCLE_ORDER_WAIT_SECONDS,
  UserLifecycleRunner,
} from './user-lifecycle-runner.ts';

const NOW = new Date('2026-11-02T07:21:00.000Z');

const USER_ID = '01JC0USER00000000000000001';

const EVENT_ID = '01JC0EVT000000000000000010';

const EARLIER_EVENT_ID = '01JC0EVT000000000000000009';

const META: MessageMeta = {
  id: 'message-1',
  type: 'identity.run-user-lifecycle',
  attempts: 1,
  sentAt: new Date('2026-11-02T07:20:00.000Z'),
};

function storedEvent(
  columns: Partial<StoredLifecycleEvent> = {},
): StoredLifecycleEvent {
  return {
    id: EVENT_ID,
    userId: USER_ID,
    type: 'withdrawn',
    occurredAt: new Date('2026-11-02T07:00:00.000Z'),
    status: 'pending',
    dispatchCount: 1,
    lastDispatchedAt: new Date('2026-11-02T07:00:00.000Z'),
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
  | { readonly kind: 'purge'; readonly userId: string }
  | { readonly kind: 'event-completed'; readonly at: Date };

function notUsed(): never {
  throw new Error('実行器はこの操作を使わない');
}

class FakeLifecycleStore implements UserLifecycleStore {
  readonly events = new Map<string, StoredLifecycleEvent>();
  readonly completed = new Map<string, Set<string>>();

  constructor(private readonly calls: Call[]) {}

  findEvent(eventId: string) {
    return Promise.resolve(this.events.get(eventId));
  }

  findOldestPending(userId: string) {
    const pending = [...this.events.values()]
      .filter((event) => event.userId === userId && event.status === 'pending')
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

  listStalePending = notUsed;
  markRedispatched = notUsed;
  createPurgeDueEvents = notUsed;
  listPurgeCandidates = notUsed;
  countOverduePurges = notUsed;
}

class FakePurgeStore implements IdentityPurgeStore {
  failure: Error | undefined;

  constructor(private readonly calls: Call[]) {}

  purge(userId: string) {
    this.calls.push({ kind: 'purge', userId });
    return this.failure === undefined
      ? Promise.resolve()
      : Promise.reject(this.failure);
  }
}

class FakeHandler implements UserLifecycleAsyncHandler {
  readonly received: UserLifecycleEvent[] = [];
  outcomes: (LifecycleHandlerOutcome | Error)[] = [];

  constructor(
    private readonly name: string,
    private readonly calls: Call[],
  ) {}

  handle(event: UserLifecycleEvent) {
    this.calls.push({ kind: 'handler', name: this.name });
    this.received.push(event);
    const next = this.outcomes.shift() ?? { kind: 'done' };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

interface Harness {
  readonly runner: MessageHandler<RunUserLifecycleBody>;
  readonly store: FakeLifecycleStore;
  readonly purgeStore: FakePurgeStore;
  readonly handlers: ReadonlyMap<string, FakeHandler>;
  readonly calls: Call[];
}

function registration(
  name: string,
  order: number,
  events: readonly UserLifecycleEventType[] = ['withdrawn', 'purge_due'],
): UserLifecycleAsyncRegistration {
  return { name, order, events, handler: Symbol.for(name) };
}

// 登録の順と異なる順序の値で並べ替えが効くことを確かめられるよう、後に登録したものほど前に動く
const REGISTRATIONS = [
  registration('identity-auth.email-suppression-cleanup', 10000),
  registration('profile.avatar-erasure', 200),
  registration('posts.post-anonymization', 100),
  registration('billing.unsuspend-sync', 300, ['unsuspended']),
];

function createHarness(
  registrations: readonly UserLifecycleAsyncRegistration[] = REGISTRATIONS,
): Harness {
  const calls: Call[] = [];
  const store = new FakeLifecycleStore(calls);
  const purgeStore = new FakePurgeStore(calls);
  const handlers = new Map(
    registrations.map(({ name }) => [name, new FakeHandler(name, calls)]),
  );
  const resolver: LifecycleHandlerResolver = {
    resolve: ({ name }) => {
      const handler = handlers.get(name);
      if (handler === undefined) {
        throw new Error(`未登録の波及処理: ${name}`);
      }
      return handler;
    },
  };
  const runner = new UserLifecycleRunner({
    store,
    registry: createAsyncLifecycleRegistry(registrations),
    resolver,
    purgeStore,
    clock: { now: () => NOW },
  });
  return { runner, store, purgeStore, handlers, calls };
}

function handlerOf(harness: Harness, name: string): FakeHandler {
  const handler = harness.handlers.get(name);
  if (handler === undefined) {
    throw new Error(`未登録の波及処理: ${name}`);
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

function lifecycleLogs(): LogRecord[] {
  return records.filter(
    (record) => record.category.join('.') === 'event.identity.lifecycle',
  );
}

describe('ユーザーライフサイクルイベントの非同期の波及処理の実行器', () => {
  test('定数は設計の60秒の待ちを表す', () => {
    expect(LIFECYCLE_ORDER_WAIT_SECONDS).toBe(60);
  });

  test('存在しないイベントは何もせず終える', async () => {
    const harness = createHarness();

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([]);
    expect(lifecycleLogs().at(-1)?.properties).toMatchObject({
      eventId: EVENT_ID,
      outcome: 'missing',
    });
  });

  test('完了済みのイベントは波及処理を呼ばずに終える', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ status: 'completed' }));

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([]);
    expect(lifecycleLogs().at(-1)?.properties).toMatchObject({
      eventId: EVENT_ID,
      type: 'withdrawn',
      outcome: 'already-completed',
    });
  });

  test('同じ利用者のより前のイベントが未完了なら、波及処理を始めず60秒遅らせる', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'unsuspended' }));
    harness.store.events.set(
      EARLIER_EVENT_ID,
      storedEvent({
        id: EARLIER_EVENT_ID,
        type: 'suspended',
        occurredAt: new Date('2026-11-02T06:00:00.000Z'),
      }),
    );

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({
      kind: 'defer',
      delaySeconds: LIFECYCLE_ORDER_WAIT_SECONDS,
    });
    expect(harness.calls).toEqual([]);
    expect(lifecycleLogs().at(-1)?.properties).toMatchObject({
      eventId: EVENT_ID,
      outcome: 'waiting-for-earlier-event',
    });
  });

  test('他の利用者の未完了のイベントは待たない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    harness.store.events.set(
      EARLIER_EVENT_ID,
      storedEvent({
        id: EARLIER_EVENT_ID,
        userId: '01JC0USER00000000000000002',
        occurredAt: new Date('2026-11-02T06:00:00.000Z'),
      }),
    );

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls.at(-1)).toEqual({ kind: 'event-completed', at: NOW });
  });

  test('種類に登録した波及処理を順序の値の昇順に実行し、1つずつ完了を記録してからイベントを完了にする', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'posts.post-anonymization' },
      {
        kind: 'handler-completed',
        name: 'posts.post-anonymization',
        at: NOW,
      },
      { kind: 'handler', name: 'profile.avatar-erasure' },
      { kind: 'handler-completed', name: 'profile.avatar-erasure', at: NOW },
      { kind: 'handler', name: 'identity-auth.email-suppression-cleanup' },
      {
        kind: 'handler-completed',
        name: 'identity-auth.email-suppression-cleanup',
        at: NOW,
      },
      { kind: 'event-completed', at: NOW },
    ]);
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('completed');
  });

  test('波及処理には記録の状態を除いたイベントを渡す', async () => {
    const harness = createHarness();
    const event = storedEvent();
    harness.store.events.set(EVENT_ID, event);

    await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(
      handlerOf(harness, 'posts.post-anonymization').received,
    ).toStrictEqual([
      {
        id: event.id,
        userId: event.userId,
        type: event.type,
        occurredAt: event.occurredAt,
      },
    ]);
  });

  test('完了を記録済みの波及処理は呼ばずに飛ばす', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    harness.store.completed.set(
      EVENT_ID,
      new Set(['posts.post-anonymization', 'profile.avatar-erasure']),
    );

    await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'identity-auth.email-suppression-cleanup' },
      {
        kind: 'handler-completed',
        name: 'identity-auth.email-suppression-cleanup',
        at: NOW,
      },
      { kind: 'event-completed', at: NOW },
    ]);
  });

  test('波及処理が登録されていない種類は、イベントの完了だけを記録する', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'suspended' }));

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([{ kind: 'event-completed', at: NOW }]);
  });

  test('波及処理に続きがあれば、完了を記録せず後の波及処理も呼ばずに5秒遅らせる', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    handlerOf(harness, 'profile.avatar-erasure').outcomes = [
      { kind: 'continue' },
    ];

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({
      kind: 'defer',
      delaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    expect(LIFECYCLE_CONTINUE_DELAY_SECONDS).toBe(5);
    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'posts.post-anonymization' },
      {
        kind: 'handler-completed',
        name: 'posts.post-anonymization',
        at: NOW,
      },
      { kind: 'handler', name: 'profile.avatar-erasure' },
    ]);
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('pending');
    expect(lifecycleLogs().at(-1)?.properties).toMatchObject({
      eventId: EVENT_ID,
      type: 'withdrawn',
      handler: 'profile.avatar-erasure',
      outcome: 'continued',
    });
  });

  test('続きの再送では、完了した波及処理を飛ばして続きの波及処理から再開する', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    handlerOf(harness, 'profile.avatar-erasure').outcomes = [
      { kind: 'continue' },
      { kind: 'done' },
    ];
    await harness.runner.handle({ eventId: EVENT_ID }, META);
    harness.calls.length = 0;

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls.map((call) => call.kind)).toEqual([
      'handler',
      'handler-completed',
      'handler',
      'handler-completed',
      'event-completed',
    ]);
    expect(harness.calls[0]).toEqual({
      kind: 'handler',
      name: 'profile.avatar-erasure',
    });
  });

  test('波及処理の例外はそのまま投げ、その波及処理とイベントの完了を記録しない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    const failure = new Error('波及処理の一時的な失敗');
    handlerOf(harness, 'profile.avatar-erasure').outcomes = [failure];

    const caught = await harness.runner
      .handle({ eventId: EVENT_ID }, META)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'posts.post-anonymization' },
      {
        kind: 'handler-completed',
        name: 'posts.post-anonymization',
        at: NOW,
      },
      { kind: 'handler', name: 'profile.avatar-erasure' },
    ]);
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('pending');
  });

  test('物理削除の開始は、全波及処理の完了の後に利用者の行を削除してからイベントを完了にする', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'purge_due' }));

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls.slice(-3)).toEqual([
      {
        kind: 'handler-completed',
        name: 'identity-auth.email-suppression-cleanup',
        at: NOW,
      },
      { kind: 'purge', userId: USER_ID },
      { kind: 'event-completed', at: NOW },
    ]);
    expect(lifecycleLogs().at(-1)?.properties).toMatchObject({
      eventId: EVENT_ID,
      type: 'purge_due',
      userId: USER_ID,
      outcome: 'completed',
    });
  });

  test('物理削除の開始で波及処理に続きがあれば、利用者の行を削除しない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'purge_due' }));
    handlerOf(harness, 'identity-auth.email-suppression-cleanup').outcomes = [
      { kind: 'continue' },
    ];

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({
      kind: 'defer',
      delaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    expect(harness.calls.some((call) => call.kind === 'purge')).toBe(false);
  });

  test('物理削除が失敗すれば例外をそのまま投げ、イベントを未完了に残す', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'purge_due' }));
    const failure = new Error('FOREIGN KEY constraint failed');
    harness.purgeStore.failure = failure;

    const caught = await harness.runner
      .handle({ eventId: EVENT_ID }, META)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
    expect(harness.calls.at(-1)).toEqual({ kind: 'purge', userId: USER_ID });
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('pending');
  });

  test('物理削除の開始以外の種類では利用者の行を削除しない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'withdrawn' }));

    await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(harness.calls.some((call) => call.kind === 'purge')).toBe(false);
  });

  test('ログの属性は伏せ字にならず、波及処理の完了も記録する', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());

    await harness.runner.handle({ eventId: EVENT_ID }, META);

    const logs = lifecycleLogs();
    expect(logs.map((record) => record.properties)).toEqual([
      {
        eventId: EVENT_ID,
        type: 'withdrawn',
        userId: USER_ID,
        handler: 'posts.post-anonymization',
        outcome: 'handler-completed',
      },
      {
        eventId: EVENT_ID,
        type: 'withdrawn',
        userId: USER_ID,
        handler: 'profile.avatar-erasure',
        outcome: 'handler-completed',
      },
      {
        eventId: EVENT_ID,
        type: 'withdrawn',
        userId: USER_ID,
        handler: 'identity-auth.email-suppression-cleanup',
        outcome: 'handler-completed',
      },
      {
        eventId: EVENT_ID,
        type: 'withdrawn',
        userId: USER_ID,
        outcome: 'completed',
      },
    ]);
    expect(logs.every((record) => record.level === 'info')).toBe(true);
  });
});
