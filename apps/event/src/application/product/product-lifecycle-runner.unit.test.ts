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
import type { RunProductLifecycleBody } from '../../../lib/core/messaging/contracts/product.ts';
import type {
  MessageHandler,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import type {
  ProductLifecycleStore,
  StoredProductLifecycleEvent,
} from '../../../lib/core/product/ports.ts';
import {
  createProductLifecycleRegistry,
  type ProductLifecycleAsyncHandler,
  type ProductLifecycleAsyncRegistration,
  type ProductLifecycleEvent,
  type ProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';
import type {
  ProductLifecycleHandlerResolver,
  ProductPurgeStore,
} from './ports.ts';
import {
  PRODUCT_LIFECYCLE_ORDER_WAIT_SECONDS,
  ProductLifecycleRunner,
} from './product-lifecycle-runner.ts';

const NOW = new Date('2026-11-09T07:21:00.000Z');

const PRODUCT_ID = '01JD0PROD00000000000000001';

const OWNER_ID = '01JC0USER00000000000000001';

const EVENT_ID = '01JD0PEVT00000000000000010';

const EARLIER_EVENT_ID = '01JD0PEVT00000000000000009';

const META: MessageMeta = {
  id: 'message-1',
  type: 'product.run-product-lifecycle',
  attempts: 1,
  sentAt: new Date('2026-11-09T07:20:00.000Z'),
};

function storedEvent(
  columns: Partial<StoredProductLifecycleEvent> = {},
): StoredProductLifecycleEvent {
  return {
    id: EVENT_ID,
    productId: PRODUCT_ID,
    ownerUserId: OWNER_ID,
    type: 'deleted',
    occurredAt: new Date('2026-11-09T07:00:00.000Z'),
    status: 'pending',
    dispatchCount: 1,
    lastDispatchedAt: new Date('2026-11-09T07:00:00.000Z'),
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
  | { readonly kind: 'purge'; readonly productId: string }
  | { readonly kind: 'event-completed'; readonly at: Date };

function notUsed(): never {
  throw new Error('実行器はこの操作を使わない');
}

class FakeLifecycleStore implements ProductLifecycleStore {
  readonly events = new Map<string, StoredProductLifecycleEvent>();
  readonly completed = new Map<string, Set<string>>();

  constructor(private readonly calls: Call[]) {}

  findEvent(eventId: string) {
    return Promise.resolve(this.events.get(eventId));
  }

  findOldestPending(productId: string) {
    const pending = [...this.events.values()]
      .filter(
        (event) => event.productId === productId && event.status === 'pending',
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

  listStalePending = notUsed;
  markRedispatched = notUsed;
  createPurgeDueEvents = notUsed;
  listPurgeCandidates = notUsed;
  listOwnedProductIds = notUsed;
  purgeDueCreatedAt = notUsed;
  countOverduePurges = notUsed;
}

class FakePurgeStore implements ProductPurgeStore {
  failure: Error | undefined;

  constructor(private readonly calls: Call[]) {}

  imageFileIds = notUsed;

  purge(productId: string) {
    this.calls.push({ kind: 'purge', productId });
    return this.failure === undefined
      ? Promise.resolve()
      : Promise.reject(this.failure);
  }
}

class FakeHandler implements ProductLifecycleAsyncHandler {
  readonly received: ProductLifecycleEvent[] = [];
  outcomes: (LifecycleHandlerOutcome | Error)[] = [];

  constructor(
    private readonly name: string,
    private readonly calls: Call[],
  ) {}

  handle(event: ProductLifecycleEvent) {
    this.calls.push({ kind: 'handler', name: this.name });
    this.received.push(event);
    const next = this.outcomes.shift() ?? { kind: 'done' };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
}

interface Harness {
  readonly runner: MessageHandler<RunProductLifecycleBody>;
  readonly store: FakeLifecycleStore;
  readonly purgeStore: FakePurgeStore;
  readonly handlers: ReadonlyMap<string, FakeHandler>;
  readonly calls: Call[];
}

function registration(
  name: string,
  order: number,
  events: readonly ProductLifecycleEventType[] = ['deleted', 'purge_due'],
): ProductLifecycleAsyncRegistration {
  return { name, order, events, handler: Symbol.for(name) };
}

// 登録の順と異なる順序の値で並べ替えが効くことを確かめられるよう、後に登録したものほど前に動く
const REGISTRATIONS = [
  registration('product-launch.image-erasure', 1000),
  registration('match.match-detachment', 200),
  registration('comments.comment-erasure', 100),
  registration('search.unhidden-sync', 300, ['unhidden']),
];

function createHarness(
  registrations: readonly ProductLifecycleAsyncRegistration[] = REGISTRATIONS,
): Harness {
  const calls: Call[] = [];
  const store = new FakeLifecycleStore(calls);
  const purgeStore = new FakePurgeStore(calls);
  const handlers = new Map(
    registrations.map(({ name }) => [name, new FakeHandler(name, calls)]),
  );
  const resolver: ProductLifecycleHandlerResolver = {
    resolve: ({ name }) => {
      const handler = handlers.get(name);
      if (handler === undefined) {
        throw new Error(`未登録の処理: ${name}`);
      }
      return handler;
    },
  };
  const runner = new ProductLifecycleRunner({
    store,
    registry: createProductLifecycleRegistry(registrations),
    resolver,
    purgeStore,
    clock: { now: () => NOW },
  });
  return { runner, store, purgeStore, handlers, calls };
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

function lifecycleLogs(): LogRecord[] {
  return records.filter(
    (record) => record.category.join('.') === 'event.product.lifecycle',
  );
}

describe('プロダクトライフサイクルイベントの非同期の処理の実行器', () => {
  test('定数は設計の60秒の待ちを表す', () => {
    expect(PRODUCT_LIFECYCLE_ORDER_WAIT_SECONDS).toBe(60);
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

  test('完了済みのイベントは処理を呼ばずに終える', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ status: 'completed' }));

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([]);
    expect(lifecycleLogs().at(-1)?.properties).toMatchObject({
      eventId: EVENT_ID,
      type: 'deleted',
      productId: PRODUCT_ID,
      outcome: 'already-completed',
    });
  });

  test('同じプロダクトのより前のイベントが未完了なら、処理を始めず60秒遅らせる', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'unhidden' }));
    harness.store.events.set(
      EARLIER_EVENT_ID,
      storedEvent({
        id: EARLIER_EVENT_ID,
        type: 'hidden',
        occurredAt: new Date('2026-11-09T06:00:00.000Z'),
      }),
    );

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({
      kind: 'defer',
      delaySeconds: PRODUCT_LIFECYCLE_ORDER_WAIT_SECONDS,
    });
    expect(harness.calls).toEqual([]);
    expect(lifecycleLogs().at(-1)?.properties).toMatchObject({
      eventId: EVENT_ID,
      outcome: 'waiting-for-earlier-event',
    });
  });

  test('他のプロダクトの未完了のイベントは待たない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    harness.store.events.set(
      EARLIER_EVENT_ID,
      storedEvent({
        id: EARLIER_EVENT_ID,
        productId: '01JD0PROD00000000000000002',
        occurredAt: new Date('2026-11-09T06:00:00.000Z'),
      }),
    );

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls.at(-1)).toEqual({ kind: 'event-completed', at: NOW });
  });

  test('種類に登録した処理を順序の値の昇順に実行し、1つずつ完了を記録してからイベントを完了にする', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'comments.comment-erasure' },
      {
        kind: 'handler-completed',
        name: 'comments.comment-erasure',
        at: NOW,
      },
      { kind: 'handler', name: 'match.match-detachment' },
      { kind: 'handler-completed', name: 'match.match-detachment', at: NOW },
      { kind: 'handler', name: 'product-launch.image-erasure' },
      {
        kind: 'handler-completed',
        name: 'product-launch.image-erasure',
        at: NOW,
      },
      { kind: 'event-completed', at: NOW },
    ]);
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('completed');
    expect(lifecycleLogs().at(-1)?.properties).toMatchObject({
      eventId: EVENT_ID,
      type: 'deleted',
      productId: PRODUCT_ID,
      outcome: 'completed',
    });
  });

  test('処理には記録の状態を除いたイベントを渡す', async () => {
    const harness = createHarness();
    const event = storedEvent();
    harness.store.events.set(EVENT_ID, event);

    await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(
      handlerOf(harness, 'comments.comment-erasure').received,
    ).toStrictEqual([
      {
        id: event.id,
        productId: event.productId,
        ownerUserId: event.ownerUserId,
        type: event.type,
        occurredAt: event.occurredAt,
      },
    ]);
  });

  test('完了を記録済みの処理は呼ばずに飛ばす', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    harness.store.completed.set(
      EVENT_ID,
      new Set(['comments.comment-erasure', 'match.match-detachment']),
    );

    await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'product-launch.image-erasure' },
      {
        kind: 'handler-completed',
        name: 'product-launch.image-erasure',
        at: NOW,
      },
      { kind: 'event-completed', at: NOW },
    ]);
  });

  test('処理が登録されていない種類は、イベントの完了だけを記録する', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'hidden' }));

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([{ kind: 'event-completed', at: NOW }]);
  });

  test('処理に続きがあれば、完了を記録せず後の処理も呼ばずに5秒遅らせる', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    handlerOf(harness, 'match.match-detachment').outcomes = [
      { kind: 'continue' },
    ];

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({
      kind: 'defer',
      delaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    expect(LIFECYCLE_CONTINUE_DELAY_SECONDS).toBe(5);
    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'comments.comment-erasure' },
      {
        kind: 'handler-completed',
        name: 'comments.comment-erasure',
        at: NOW,
      },
      { kind: 'handler', name: 'match.match-detachment' },
    ]);
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('pending');
    expect(lifecycleLogs().at(-1)?.properties).toMatchObject({
      eventId: EVENT_ID,
      type: 'deleted',
      handler: 'match.match-detachment',
      outcome: 'continued',
    });
  });

  test('続きの再送では、完了した処理を飛ばして続きの処理から再開する', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    handlerOf(harness, 'match.match-detachment').outcomes = [
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
      name: 'match.match-detachment',
    });
  });

  test('処理の例外はそのまま投げ、その処理とイベントの完了を記録しない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());
    const failure = new Error('処理の一時的な失敗');
    handlerOf(harness, 'match.match-detachment').outcomes = [failure];

    const caught = await harness.runner
      .handle({ eventId: EVENT_ID }, META)
      .catch((error: unknown) => error);

    expect(caught).toBe(failure);
    expect(harness.calls).toEqual([
      { kind: 'handler', name: 'comments.comment-erasure' },
      {
        kind: 'handler-completed',
        name: 'comments.comment-erasure',
        at: NOW,
      },
      { kind: 'handler', name: 'match.match-detachment' },
    ]);
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('pending');
  });

  test('物理削除の時期の到来は、全処理の完了の後にプロダクトの行を物理削除し、消えたイベントの完了は記録しない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'purge_due' }));

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls.slice(-2)).toEqual([
      {
        kind: 'handler-completed',
        name: 'product-launch.image-erasure',
        at: NOW,
      },
      { kind: 'purge', productId: PRODUCT_ID },
    ]);
    expect(harness.calls.some((call) => call.kind === 'event-completed')).toBe(
      false,
    );
    expect(lifecycleLogs().at(-1)?.properties).toMatchObject({
      eventId: EVENT_ID,
      type: 'purge_due',
      productId: PRODUCT_ID,
      outcome: 'purged',
    });
  });

  test('物理削除の時期の到来で処理に続きがあれば、プロダクトの行を物理削除しない', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'purge_due' }));
    handlerOf(harness, 'product-launch.image-erasure').outcomes = [
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
    expect(harness.calls.at(-1)).toEqual({
      kind: 'purge',
      productId: PRODUCT_ID,
    });
    expect(harness.store.events.get(EVENT_ID)?.status).toBe('pending');
  });

  test.each(['deleted', 'hidden', 'unhidden'] as const)(
    '物理削除の時期の到来以外の種類(%s)ではプロダクトの行を物理削除しない',
    async (type) => {
      const harness = createHarness();
      harness.store.events.set(EVENT_ID, storedEvent({ type }));

      await harness.runner.handle({ eventId: EVENT_ID }, META);

      expect(harness.calls.some((call) => call.kind === 'purge')).toBe(false);
      expect(harness.calls.at(-1)).toEqual({
        kind: 'event-completed',
        at: NOW,
      });
    },
  );

  test('登録が空の初版でも、物理削除の時期の到来でプロダクトの行を物理削除する', async () => {
    const harness = createHarness([]);
    harness.store.events.set(EVENT_ID, storedEvent({ type: 'purge_due' }));

    const result = await harness.runner.handle({ eventId: EVENT_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(harness.calls).toEqual([{ kind: 'purge', productId: PRODUCT_ID }]);
  });

  test('ログの属性は伏せ字にならず、処理の完了も記録する', async () => {
    const harness = createHarness();
    harness.store.events.set(EVENT_ID, storedEvent());

    await harness.runner.handle({ eventId: EVENT_ID }, META);

    const handlerLogs = lifecycleLogs().filter(
      (record) => record.properties['outcome'] === 'handler-completed',
    );
    expect(handlerLogs.map((record) => record.properties)).toEqual([
      {
        eventId: EVENT_ID,
        type: 'deleted',
        productId: PRODUCT_ID,
        handler: 'comments.comment-erasure',
        outcome: 'handler-completed',
      },
      {
        eventId: EVENT_ID,
        type: 'deleted',
        productId: PRODUCT_ID,
        handler: 'match.match-detachment',
        outcome: 'handler-completed',
      },
      {
        eventId: EVENT_ID,
        type: 'deleted',
        productId: PRODUCT_ID,
        handler: 'product-launch.image-erasure',
        outcome: 'handler-completed',
      },
    ]);
  });
});
