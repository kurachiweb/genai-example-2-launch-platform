import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { type Container, ContainerModule } from 'inversify';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { LifecycleRegistrationError } from '../../lib/core/identity/user-lifecycle.ts';
import {
  createMatchEventRegistry,
  MATCH_EVENT_RETRY_POLICY,
  type MatchEvent,
  type MatchEventHandler,
  type MatchEventRegistration,
} from '../../lib/core/match/match-events.ts';
import { RUN_MATCH_EVENT_MESSAGE } from '../../lib/core/messaging/contracts/match.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import {
  DECIDED_AT,
  STARTS_AT,
} from '../../lib/workers/match/testing/directory-fixtures.ts';
import {
  insertHandlerRun,
  insertMatchEvents,
  matchEventIdOf,
  readHandlerRuns,
  readMatchEvent,
} from '../../lib/workers/match/testing/event-fixtures.ts';
import { matchIdOf } from '../../lib/workers/match/testing/match-fixtures.ts';
import { seedMatchPlatformSample } from '../../lib/workers/match/testing/match-platform-fixtures.ts';
import { EVENT_MATCH_TYPES } from '../application/match/event-match-types.ts';
import {
  MATCH_EVENT_ORDER_WAIT_SECONDS,
  MatchEventRunner,
} from '../application/match/match-event-runner.ts';
import { QualifierOutcomeHandler } from '../application/match/qualifier-outcome-handler.ts';
import { MATCH_EVENT_HANDLERS } from './match-event-handlers.ts';
import {
  createEventMatchModule,
  EVENT_MATCH_MODULE,
  EVENT_MATCH_PLATFORM_MODULE,
} from './match-module.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';
import { MODULES } from './modules.ts';
import {
  dispatchMatchEvent,
  matchEventEnvelope,
  type QueueHandler,
} from './testing/match-event-queue.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'scheduled', 'queue'] as const;

const MATCH = 1;

const EVENT = 10;

const FIRST = Symbol.for('test.FirstMatchEventHandler');

const SECOND = Symbol.for('test.SecondMatchEventHandler');

// orderの降順に並べ、登録簿がorderの昇順に並べ直すことを確かめる
const FAKE_REGISTRATIONS: readonly MatchEventRegistration[] = [
  {
    name: 'match-test.second',
    events: ['decided'],
    order: 200,
    handler: SECOND,
  },
  {
    name: 'match-test.first',
    events: ['decided'],
    kinds: ['qualifier'],
    order: 100,
    handler: FIRST,
  },
];

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

// eventのマッチのモジュールだけを偽の登録で組み立て直し、偽の処理の束縛を加えた一覧で本番と同じconsumerを動かす
function createFakeQueueHandler(
  calls: { readonly name: string; readonly event: MatchEvent }[],
  failSecond: { remaining: number },
): QueueHandler {
  const fakeHandler = (
    name: string,
    fail: () => boolean,
  ): MatchEventHandler => ({
    handle: (event) => {
      calls.push({ name, event });
      return fail()
        ? Promise.reject(new Error(`${name}の失敗`))
        : Promise.resolve({ kind: 'done' });
    },
  });
  const fakes = {
    name: 'fake-match-event-handlers',
    bindings: new ContainerModule(({ bind }) => {
      bind<MatchEventHandler>(FIRST).toConstantValue(
        fakeHandler('first', () => false),
      );
      bind<MatchEventHandler>(SECOND).toConstantValue(
        fakeHandler('second', () => {
          if (failSecond.remaining === 0) {
            return false;
          }
          failSecond.remaining -= 1;
          return true;
        }),
      );
    }),
  };
  const modules = [
    ...MODULES.map((module) =>
      module === EVENT_MATCH_MODULE
        ? createEventMatchModule({ eventHandlers: FAKE_REGISTRATIONS })
        : module,
    ),
    fakes,
  ];
  const dispatcher = createQueueDispatcher(MESSAGE_HANDLERS, modules);
  return (batch, runtimeEnv, ctx) =>
    dispatcher.dispatch(batch, runtimeEnv, ctx);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await seedMatchPlatformSample();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('イベントサーバーのモジュールの一覧へのマッチの登録', () => {
  test('eventのマッチのモジュールを、マッチの共通の束縛の直後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(EVENT_MATCH_MODULE.name).toBe('event-match');
    expect(
      MODULES.filter((module) => module === EVENT_MATCH_MODULE),
    ).toHaveLength(1);
    expect(MODULES.indexOf(EVENT_MATCH_MODULE)).toBe(
      MODULES.indexOf(EVENT_MATCH_PLATFORM_MODULE) + 1,
    );
    expect(names.indexOf('event-match')).toBeGreaterThan(
      names.indexOf('match-platform'),
    );
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、マッチイベントの実行器と予選の結果の記録の処理を実装のクラスに解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(container.get(EVENT_MATCH_TYPES.MatchEventRunner)).toBeInstanceOf(
        MatchEventRunner,
      );
      expect(
        container.get(EVENT_MATCH_TYPES.QualifierOutcomeHandler),
      ).toBeInstanceOf(QualifierOutcomeHandler);
    },
  );
});

describe('マッチイベントの処理の登録口', () => {
  test('予選の結果の記録の処理を、予選の確定のイベントに帯の1100で登録した凍結済みの配列で、登録の検証を通る', () => {
    expect(MATCH_EVENT_HANDLERS).toStrictEqual([
      {
        name: 'match-engine.qualifier-outcome',
        events: ['decided'],
        kinds: ['qualifier'],
        order: 1100,
        handler: EVENT_MATCH_TYPES.QualifierOutcomeHandler,
      },
    ]);
    expect(Object.isFrozen(MATCH_EVENT_HANDLERS)).toBe(true);
    expect(() => createMatchEventRegistry(MATCH_EVENT_HANDLERS)).not.toThrow();
  });

  test('同じ種類でorderが重複した登録は、最初のメッセージではなくモジュールの組み立ての時点で例外になる', () => {
    expect(() =>
      createEventMatchModule({
        eventHandlers: [
          {
            name: 'match-test.first',
            events: ['decided'],
            kinds: ['qualifier'],
            order: 100,
            handler: FIRST,
          },
          {
            name: 'match-test.second',
            events: ['decided'],
            kinds: ['week'],
            order: 100,
            handler: SECOND,
          },
        ],
      }),
    ).toThrow(LifecycleRegistrationError);
  });

  test('対象の種別を空の配列で指定した登録は、モジュールの組み立ての時点で例外になる', () => {
    expect(() =>
      createEventMatchModule({
        eventHandlers: [
          {
            name: 'match-test.first',
            events: ['decided'],
            kinds: [],
            order: 100,
            handler: FIRST,
          },
        ],
      }),
    ).toThrow(LifecycleRegistrationError);
  });
});

describe('マッチイベントのメッセージの処理の登録', () => {
  test('match.run-match-eventを実行器へ、最大5回の再試行の方針で登録する', () => {
    expect(
      MESSAGE_HANDLERS.filter(
        ({ contract }) => contract.type === RUN_MATCH_EVENT_MESSAGE.type,
      ),
    ).toStrictEqual([
      {
        contract: RUN_MATCH_EVENT_MESSAGE,
        handler: EVENT_MATCH_TYPES.MatchEventRunner,
        retry: MATCH_EVENT_RETRY_POLICY,
      },
    ]);
    expect(MATCH_EVENT_RETRY_POLICY.maxAttempts).toBe(5);
    expect(() =>
      createQueueDispatcher(MESSAGE_HANDLERS, MODULES),
    ).not.toThrow();
  });
});

describe('マッチイベントのメッセージの処理', () => {
  test('処理の登録が無いイベントは完了にしてackする', async () => {
    await insertMatchEvents([
      { index: EVENT, match: MATCH, type: 'started', occurredAt: STARTS_AT },
    ]);

    const outcome = await dispatchMatchEvent(
      matchEventEnvelope(matchEventIdOf(EVENT)),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(readMatchEvent(matchEventIdOf(EVENT))).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('存在しないイベントのメッセージは何もせずackする', async () => {
    const outcome = await dispatchMatchEvent(
      matchEventEnvelope(matchEventIdOf(EVENT)),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
  });

  test('同じマッチのより前の未完了のイベントがあれば、処理せずに60秒後に送り直す', async () => {
    await insertMatchEvents([
      {
        index: EVENT - 1,
        match: MATCH,
        type: 'started',
        occurredAt: new Date(DECIDED_AT.getTime() - 86_400_000),
      },
      { index: EVENT, match: MATCH, type: 'decided', occurredAt: DECIDED_AT },
    ]);

    const outcome = await dispatchMatchEvent(
      matchEventEnvelope(matchEventIdOf(EVENT)),
    );

    expect(outcome).toStrictEqual({
      acked: true,
      retried: false,
      resentDelaySeconds: MATCH_EVENT_ORDER_WAIT_SECONDS,
    });
    await expect(readMatchEvent(matchEventIdOf(EVENT))).resolves.toMatchObject({
      status: 'pending',
    });
  });

  test('登録した処理を順に呼んで完了を記録し、失敗した処理は再試行で完了した処理を飛ばして続け、全て終えてからイベントを完了にする', async () => {
    await insertMatchEvents([
      { index: EVENT, match: MATCH, type: 'decided', occurredAt: DECIDED_AT },
    ]);
    const calls: { readonly name: string; readonly event: MatchEvent }[] = [];
    const handler = createFakeQueueHandler(calls, { remaining: 1 });
    const envelope = matchEventEnvelope(matchEventIdOf(EVENT));

    const first = await dispatchMatchEvent(envelope, handler);

    expect(first).toMatchObject({ acked: false, retried: true });
    expect(calls.map(({ name }) => name)).toStrictEqual(['first', 'second']);
    expect(calls[0]?.event).toStrictEqual({
      id: matchEventIdOf(EVENT),
      matchId: matchIdOf(MATCH),
      kind: 'qualifier',
      type: 'decided',
      occurredAt: DECIDED_AT,
    });
    await expect(readHandlerRuns()).resolves.toMatchObject([
      { eventId: matchEventIdOf(EVENT), handlerName: 'match-test.first' },
    ]);
    await expect(readMatchEvent(matchEventIdOf(EVENT))).resolves.toMatchObject({
      status: 'pending',
    });

    const second = await dispatchMatchEvent(envelope, handler);

    expect(second).toStrictEqual({ acked: true, retried: false });
    expect(calls.map(({ name }) => name)).toStrictEqual([
      'first',
      'second',
      'second',
    ]);
    await expect(readHandlerRuns()).resolves.toMatchObject([
      { handlerName: 'match-test.first' },
      { handlerName: 'match-test.second' },
    ]);
    await expect(readMatchEvent(matchEventIdOf(EVENT))).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('完了を記録済みの処理は、メッセージが重ねて届いても呼ばない', async () => {
    await insertMatchEvents([
      { index: EVENT, match: MATCH, type: 'decided', occurredAt: DECIDED_AT },
    ]);
    await insertHandlerRun(1, EVENT, 'match-test.first');
    const calls: { readonly name: string; readonly event: MatchEvent }[] = [];

    const outcome = await dispatchMatchEvent(
      matchEventEnvelope(matchEventIdOf(EVENT)),
      createFakeQueueHandler(calls, { remaining: 0 }),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    expect(calls.map(({ name }) => name)).toStrictEqual(['second']);
  });
});
