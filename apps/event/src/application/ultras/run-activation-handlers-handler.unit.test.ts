import { describe, expect, test } from 'bun:test';

import type {
  MessageHandler,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  createUltrasActivationRegistry,
  type UltrasActivation,
  type UltrasActivationHandler,
  type UltrasActivationHandlerRegistration,
} from '../../../lib/core/ultras/activation-contract.ts';
import type { RunActivationHandlersBody } from '../../../lib/core/ultras/activation-message.ts';
import type {
  ActivationStore,
  UltrasActivationRow,
} from '../../../lib/core/ultras/ports.ts';
import {
  type ActivationHandlerResolver,
  RunActivationHandlersHandler,
} from './run-activation-handlers-handler.ts';

const NOW = new Date('2026-11-02T07:21:00.000Z');

const ACTIVATION_ID = '01JC0ACT1VAT10N00000000001';

const USER_ID = '01JC0USER00000000000000001';

const STRIPE_SUBSCRIPTION_ID = 'sub_test_activation_1';

const ACTIVATED_AT = new Date('2026-11-02T07:00:00.000Z');

const META: MessageMeta = {
  id: 'message-1',
  type: 'ultras.run-activation-handlers',
  attempts: 1,
  sentAt: new Date('2026-11-02T07:20:00.000Z'),
};

const FIRST = Symbol.for('test.FirstActivationHandler');

const SECOND = Symbol.for('test.SecondActivationHandler');

// orderの降順に並べ、登録簿がorderの昇順に並べ直すことを確かめる
const REGISTRATIONS: readonly UltrasActivationHandlerRegistration[] = [
  { name: 'tournament-year.second', order: 200, handler: SECOND },
  { name: 'tournament-week.first', order: 100, handler: FIRST },
];

type Call =
  | {
      readonly kind: 'handler';
      readonly name: string;
      readonly activation: UltrasActivation;
    }
  | { readonly kind: 'completed'; readonly id: string; readonly at: Date };

class HandlerFailure extends Error {
  override readonly name = 'HandlerFailure';
}

function notUsed(): never {
  throw new Error('知らせの処理はこの操作を使わない');
}

class FakeActivationStore implements ActivationStore {
  readonly rows = new Map<string, UltrasActivationRow>();

  constructor(private readonly calls: Call[]) {}

  findById(id: string) {
    return Promise.resolve(this.rows.get(id));
  }

  markCompleted(id: string, at: Date) {
    this.calls.push({ kind: 'completed', id, at });
    return Promise.resolve();
  }

  findByStripeId = notUsed;
  markDispatched = notUsed;
  findUndispatched = notUsed;
  deleteCompletedBefore = notUsed;
}

function activationRow(
  columns: Partial<UltrasActivationRow> = {},
): UltrasActivationRow {
  return {
    id: ACTIVATION_ID,
    userId: USER_ID,
    stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
    activatedAt: ACTIVATED_AT,
    dispatchedAt: new Date('2026-11-02T07:00:01.000Z'),
    completedAt: null,
    createdAt: ACTIVATED_AT,
    ...columns,
  };
}

function recordingHandler(
  name: string,
  calls: Call[],
  failure?: Error,
): UltrasActivationHandler {
  return {
    handle: (activation) => {
      calls.push({ kind: 'handler', name, activation });
      return failure === undefined
        ? Promise.resolve()
        : Promise.reject(failure);
    },
  };
}

interface Harness {
  readonly handler: MessageHandler<RunActivationHandlersBody>;
  readonly store: FakeActivationStore;
}

// 処理と完了の記録の呼び出しを1つの配列に記録し、順序を確かめられるようにする
function createHarness(
  calls: Call[],
  handlers: ReadonlyMap<symbol, UltrasActivationHandler>,
  registrations: readonly UltrasActivationHandlerRegistration[] = REGISTRATIONS,
): Harness {
  const store = new FakeActivationStore(calls);
  const resolver: ActivationHandlerResolver = {
    resolve: (registration) => {
      const resolved = handlers.get(registration.handler as symbol);
      if (resolved === undefined) {
        throw new Error(`束縛されていない処理: ${registration.name}`);
      }
      return resolved;
    },
  };
  const clock: Clock = { now: () => NOW };
  const handler = new RunActivationHandlersHandler({
    activations: store,
    registry: createUltrasActivationRegistry(registrations),
    resolver,
    clock,
  });
  return { handler, store };
}

function handlersOf(calls: Call[], secondFailure?: Error) {
  return new Map<symbol, UltrasActivationHandler>([
    [FIRST, recordingHandler('first', calls)],
    [SECOND, recordingHandler('second', calls, secondFailure)],
  ]);
}

describe('RunActivationHandlersHandler', () => {
  test('知らせの行が無ければ処理を呼ばず、完了も記録せずに終える', async () => {
    const calls: Call[] = [];
    const { handler } = createHarness(calls, handlersOf(calls));

    const result = await handler.handle({ activationId: ACTIVATION_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(calls).toEqual([]);
  });

  test('完了済みの知らせは処理を呼ばず、完了の記録も改めずに終える', async () => {
    const calls: Call[] = [];
    const { handler, store } = createHarness(calls, handlersOf(calls));
    store.rows.set(
      ACTIVATION_ID,
      activationRow({ completedAt: new Date('2026-11-02T07:10:00.000Z') }),
    );

    const result = await handler.handle({ activationId: ACTIVATION_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(calls).toEqual([]);
  });

  test('登録のorderの昇順に各処理へ知らせの内容を渡し、すべて成功したら現在時刻で完了を記録する', async () => {
    const calls: Call[] = [];
    const { handler, store } = createHarness(calls, handlersOf(calls));
    store.rows.set(ACTIVATION_ID, activationRow());
    const activation: UltrasActivation = {
      activationId: ACTIVATION_ID,
      userId: USER_ID,
      stripeSubscriptionId: STRIPE_SUBSCRIPTION_ID,
      activatedAt: ACTIVATED_AT,
    };

    const result = await handler.handle({ activationId: ACTIVATION_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(calls).toEqual([
      { kind: 'handler', name: 'first', activation },
      { kind: 'handler', name: 'second', activation },
      { kind: 'completed', id: ACTIVATION_ID, at: NOW },
    ]);
  });

  test('処理へ渡す知らせの内容は送り出しや完了の記録の状態を含まない', async () => {
    const calls: Call[] = [];
    const { handler, store } = createHarness(calls, handlersOf(calls));
    store.rows.set(ACTIVATION_ID, activationRow());

    await handler.handle({ activationId: ACTIVATION_ID }, META);

    const [first] = calls;
    if (first?.kind !== 'handler') {
      throw new Error('最初の呼び出しは処理のはず');
    }
    expect(Object.keys(first.activation).toSorted()).toEqual([
      'activatedAt',
      'activationId',
      'stripeSubscriptionId',
      'userId',
    ]);
  });

  test('処理の1つが例外を投げたら、後の処理を呼ばず完了を記録せずに同じ例外を投げる', async () => {
    const calls: Call[] = [];
    const failure = new HandlerFailure('一時的な障害');
    const { handler, store } = createHarness(
      calls,
      handlersOf(calls, failure),
      // 失敗する処理を先に並べ、後の処理が呼ばれないことを確かめる
      [
        { name: 'tournament-year.second', order: 100, handler: SECOND },
        { name: 'tournament-week.first', order: 200, handler: FIRST },
      ],
    );
    store.rows.set(ACTIVATION_ID, activationRow());

    const thrown = await handler
      .handle({ activationId: ACTIVATION_ID }, META)
      .catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(calls.map((call) => call.kind)).toEqual(['handler']);
    expect(calls[0]).toMatchObject({ kind: 'handler', name: 'second' });
  });

  test('登録が1つも無ければ処理を呼ばずに完了を記録する', async () => {
    const calls: Call[] = [];
    const { handler, store } = createHarness(calls, handlersOf(calls), []);
    store.rows.set(ACTIVATION_ID, activationRow());

    const result = await handler.handle({ activationId: ACTIVATION_ID }, META);

    expect(result).toEqual({ kind: 'done' });
    expect(calls).toEqual([{ kind: 'completed', id: ACTIVATION_ID, at: NOW }]);
  });
});
