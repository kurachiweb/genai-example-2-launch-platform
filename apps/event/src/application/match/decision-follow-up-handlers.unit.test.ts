import { describe, expect, test } from 'bun:test';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import type {
  MatchEventDispatcher,
  MatchEventStore,
} from '../../../lib/core/match/ports.ts';
import type {
  ProductLifecycleEvent,
  ProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  AccountDecisionFollowUpHandler,
  DECISION_FOLLOW_UP_LIMIT,
  DECISION_FOLLOW_UP_LOOKBACK_MS,
  ProductDecisionFollowUpHandler,
} from './decision-follow-up-handlers.ts';

const NOW = new Date('2026-11-20T03:00:05.000Z');

const OCCURRED_AT = new Date('2026-11-20T03:00:00.000Z');

const DECIDED_SINCE = new Date('2026-11-19T03:00:00.000Z');

const CREATED = Object.freeze([
  '01JD0MEVT00000000000000021',
  '01JD0MEVT00000000000000022',
]);

const clock: Clock = { now: () => NOW };

type CreateMissingInput = Parameters<
  MatchEventStore['createMissingDecidedEvents']
>;

interface Recorded {
  readonly store: MatchEventStore;
  readonly dispatcher: MatchEventDispatcher;
  readonly creations: readonly CreateMissingInput[];
  readonly published: readonly (readonly string[])[];
}

function unexpected(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

// 確定のイベントの作成と送信だけを記録し、他の操作は呼ばれたら失敗させる
function recorded(
  created: readonly string[] | Error,
  publishError?: Error,
): Recorded {
  const creations: CreateMissingInput[] = [];
  const published: (readonly string[])[] = [];
  const store: MatchEventStore = {
    findEvent: unexpected,
    findOldestPending: unexpected,
    completedHandlers: unexpected,
    markHandlerCompleted: unexpected,
    markEventCompleted: unexpected,
    listStalePending: unexpected,
    markRedispatched: unexpected,
    deleteCompletedBefore: unexpected,
    createMissingDecidedEvents: (...input) => {
      creations.push(input);
      return created instanceof Error
        ? Promise.reject(created)
        : Promise.resolve(created);
    },
  };
  const dispatcher: MatchEventDispatcher = {
    publish: (eventIds) => {
      published.push([...eventIds]);
      return publishError === undefined
        ? Promise.resolve()
        : Promise.reject(publishError);
    },
  };
  return { store, dispatcher, creations, published };
}

function userEventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return Object.freeze({
    id: '01JC0EVT000000000000000041',
    userId: '01JC0USER00000000000000001',
    type,
    occurredAt: OCCURRED_AT,
  });
}

function productEventOf(
  type: ProductLifecycleEventType,
): ProductLifecycleEvent {
  return Object.freeze({
    id: '01JD0PEVT00000000000000041',
    productId: '01JD0PROD00000000000000001',
    ownerUserId: '01JC0USER00000000000000001',
    type,
    occurredAt: OCCURRED_AT,
  });
}

type HandlerRun = (
  store: MatchEventStore,
  dispatcher: MatchEventDispatcher,
) => Promise<LifecycleHandlerOutcome>;

function runAccountHandler(event: UserLifecycleEvent): HandlerRun {
  return (store, dispatcher) =>
    new AccountDecisionFollowUpHandler(store, dispatcher, clock).handle(event);
}

function runProductHandler(event: ProductLifecycleEvent): HandlerRun {
  return (store, dispatcher) =>
    new ProductDecisionFollowUpHandler(store, dispatcher, clock).handle(event);
}

function eventIdsOf(count: number): readonly string[] {
  return Array.from(
    { length: count },
    (_, index) => `01JD0MEVT${String(index + 1).padStart(17, '0')}`,
  );
}

describe('即時の終了の後続の処理の上限', () => {
  test('確定の日時を発生日時の1日前から探し、1回に100件までイベントを作る', () => {
    expect(DECISION_FOLLOW_UP_LOOKBACK_MS).toBe(86_400_000);
    expect(DECISION_FOLLOW_UP_LIMIT).toBe(100);
  });

  test.each([
    [
      'ユーザー',
      DECISION_FOLLOW_UP_LIMIT,
      'continue',
      runAccountHandler(userEventOf('withdrawn')),
    ],
    [
      'プロダクト',
      DECISION_FOLLOW_UP_LIMIT,
      'continue',
      runProductHandler(productEventOf('hidden')),
    ],
    [
      'ユーザー',
      DECISION_FOLLOW_UP_LIMIT - 1,
      'done',
      runAccountHandler(userEventOf('suspended')),
    ],
    [
      'プロダクト',
      DECISION_FOLLOW_UP_LIMIT - 1,
      'done',
      runProductHandler(productEventOf('deleted')),
    ],
  ] as const)(
    '%sの処理は、%i件を作ったら送って%sを返す',
    async (_, count, kind, run) => {
      const created = eventIdsOf(count);
      const { store, dispatcher, published } = recorded(created);

      const outcome = await run(store, dispatcher);

      expect(outcome).toStrictEqual({ kind });
      expect(published).toStrictEqual([[...created]]);
    },
  );
});

describe('AccountDecisionFollowUpHandler', () => {
  test.each(['withdrawn', 'suspended'] as const)(
    '%sのイベントで、発生日時の1日前以降に確定して確定のイベントが無いマッチにイベントを作って送り、完了を返す',
    async (type) => {
      const { store, dispatcher, creations, published } = recorded(CREATED);
      const handler = new AccountDecisionFollowUpHandler(
        store,
        dispatcher,
        clock,
      );

      const outcome = await handler.handle(userEventOf(type));

      expect(outcome).toStrictEqual({ kind: 'done' });
      expect(creations).toStrictEqual([
        [DECIDED_SINCE, NOW, DECISION_FOLLOW_UP_LIMIT],
      ]);
      expect(published).toStrictEqual([[...CREATED]]);
    },
  );

  test('作るイベントが無ければ送らずに完了を返す', async () => {
    const { store, dispatcher, published } = recorded([]);
    const handler = new AccountDecisionFollowUpHandler(
      store,
      dispatcher,
      clock,
    );

    const outcome = await handler.handle(userEventOf('withdrawn'));

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(published).toStrictEqual([]);
  });

  test('イベントの作成の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1への書き込みに失敗しました');
    const { store, dispatcher, published } = recorded(failure);
    const handler = new AccountDecisionFollowUpHandler(
      store,
      dispatcher,
      clock,
    );

    expect(
      await handler
        .handle(userEventOf('suspended'))
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
    expect(published).toStrictEqual([]);
  });
});

describe('ProductDecisionFollowUpHandler', () => {
  test.each(['hidden', 'deleted'] as const)(
    '%sのイベントで、発生日時の1日前以降に確定して確定のイベントが無いマッチにイベントを作って送り、完了を返す',
    async (type) => {
      const { store, dispatcher, creations, published } = recorded(CREATED);
      const handler = new ProductDecisionFollowUpHandler(
        store,
        dispatcher,
        clock,
      );

      const outcome = await handler.handle(productEventOf(type));

      expect(outcome).toStrictEqual({ kind: 'done' });
      expect(creations).toStrictEqual([
        [DECIDED_SINCE, NOW, DECISION_FOLLOW_UP_LIMIT],
      ]);
      expect(published).toStrictEqual([[...CREATED]]);
    },
  );

  test('作るイベントが無ければ送らずに完了を返す', async () => {
    const { store, dispatcher, published } = recorded([]);
    const handler = new ProductDecisionFollowUpHandler(
      store,
      dispatcher,
      clock,
    );

    const outcome = await handler.handle(productEventOf('hidden'));

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(published).toStrictEqual([]);
  });

  test('送信の部品の例外は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('想定外の失敗');
    const { store, dispatcher } = recorded(CREATED, failure);
    const handler = new ProductDecisionFollowUpHandler(
      store,
      dispatcher,
      clock,
    );

    expect(
      await handler
        .handle(productEventOf('deleted'))
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
