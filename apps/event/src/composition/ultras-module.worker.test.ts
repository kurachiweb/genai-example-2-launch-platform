import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
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

import { createAsyncLifecycleRegistry } from '../../lib/core/identity/user-lifecycle.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { decideOnFailure } from '../../lib/core/messaging/retry-policy.ts';
import {
  createUltrasActivationRegistry,
  type UltrasActivation,
  type UltrasActivationHandler,
  type UltrasActivationHandlerRegistration,
  UltrasActivationRegistrationError,
} from '../../lib/core/ultras/activation-contract.ts';
import {
  ULTRAS_ACTIVATION_RETRY_POLICY,
  ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE,
} from '../../lib/core/ultras/activation-message.ts';
import { ULTRAS_TYPES } from '../../lib/core/ultras/identifiers.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import { QueueActivationDispatcher } from '../../lib/workers/ultras/activation-dispatcher.ts';
import { D1ActivationStore } from '../../lib/workers/ultras/d1-activation-store.ts';
import { D1NoticeStore } from '../../lib/workers/ultras/d1-notice-store.ts';
import { D1PromotionFlagReader } from '../../lib/workers/ultras/d1-promotion-flag-reader.ts';
import { D1SubscriptionStore } from '../../lib/workers/ultras/d1-subscription-store.ts';
import { PlanStateSink } from '../../lib/workers/ultras/plan-state-sink.ts';
import {
  activatedSubscriptionRow,
  clearUltrasTables,
  insertActivationRow,
  insertSubscriptionRow,
  insertUser,
  newActivationRow,
  readActivationRow,
  stripeSubscriptionIdOf,
  T0,
  userIdOf,
} from '../../lib/workers/ultras/testing/ultras-store-fixtures.ts';
import { StoredUltrasEntitlements } from '../../lib/workers/ultras/ultras-entitlements.ts';
import { UltrasFulfillment } from '../../lib/workers/ultras/ultras-fulfillment.ts';
import { EmailUltrasNotifier } from '../../lib/workers/ultras/ultras-notifier.ts';
import { UltrasOfferPolicy } from '../../lib/workers/ultras/ultras-offer-policy.ts';
import { StoredUltrasPlanExport } from '../../lib/workers/ultras/ultras-plan-export.ts';
import { EVENT_ULTRAS_TYPES } from '../application/ultras/event-ultras-types.ts';
import { RunActivationHandlersHandler } from '../application/ultras/run-activation-handlers-handler.ts';
import { SubscriptionCancellationHandler } from '../application/ultras/subscription-cancellation-handler.ts';
import { SubscriptionErasureHandler } from '../application/ultras/subscription-erasure-handler.ts';
import { D1UltrasAccountDataEraser } from '../infrastructure/ultras/d1-ultras-account-data-eraser.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';
import { MODULES } from './modules.ts';
import { ULTRAS_ACTIVATION_HANDLERS } from './ultras-activation-handlers.ts';
import {
  createEventUltrasModule,
  EVENT_ULTRAS_MODULE,
  EVENT_ULTRAS_PLATFORM_MODULE,
} from './ultras-module.ts';
import { USER_LIFECYCLE_ASYNC_HANDLERS } from './user-lifecycle-async-handlers.ts';

declare global {
  // @cloudflare/vitest-pool-workers 0.23.0の型定義はgetQueueResultの戻り値にこの型を使うが、宣言を含まない
  interface FetcherQueueResult {
    readonly outcome: string;
    readonly ackAll: boolean;
    readonly retryBatch: { readonly retry: boolean };
    readonly explicitAcks: readonly string[];
    readonly retryMessages: readonly { readonly msgId: string }[];
  }
}

interface MessageOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly delaySeconds?: number;
}

type QueueHandler = (
  batch: MessageBatch,
  env: Env,
  ctx: ExecutionContext,
) => Promise<void>;

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

// メッセージの本文の知らせのIDはULIDの形でなければデッドレターへ移るため、フィクスチャのIDではなくULIDの文字だけで作る
const ACTIVATION_ID = '01JC0ACT1VAT10N00000000001';

const FIRST = Symbol.for('test.FirstUltrasActivationHandler');

const SECOND = Symbol.for('test.SecondUltrasActivationHandler');

// orderの降順に並べ、登録簿がorderの昇順に並べ直すことを確かめる
const FAKE_REGISTRATIONS: readonly UltrasActivationHandlerRegistration[] = [
  { name: 'ultras-test.second', order: 200, handler: SECOND },
  { name: 'ultras-test.first', order: 100, handler: FIRST },
];

const IMPLEMENTATIONS = [
  ['SubscriptionStore', D1SubscriptionStore],
  ['SubscriptionStatements', D1SubscriptionStore],
  ['ActivationStore', D1ActivationStore],
  ['ActivationStatements', D1ActivationStore],
  ['NoticeStore', D1NoticeStore],
  ['NoticeStatements', D1NoticeStore],
  ['UltrasPromotionFlagReader', D1PromotionFlagReader],
  ['UltrasEntitlements', StoredUltrasEntitlements],
  ['UltrasPlanExport', StoredUltrasPlanExport],
  ['ActivationDispatcher', QueueActivationDispatcher],
  ['UltrasNotifier', EmailUltrasNotifier],
  ['UltrasOfferPolicy', UltrasOfferPolicy],
  ['UltrasFulfillment', UltrasFulfillment],
  ['PlanStateSink', PlanStateSink],
] as const;

let envelopeCount = 0;

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'queue',
        correlationId: 'correlation-event-ultras-module',
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function activationEnvelope(activationId: string): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type: ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.type,
    id: `01JC0ACTMSG${String(envelopeCount).padStart(15, '0')}`,
    sentAt: T0.toISOString(),
    body: { activationId },
  };
}

// 本番と同じQueueのconsumer・メッセージの処理の一覧・モジュールの一覧で処理する
const defaultQueueHandler: QueueHandler = (batch, runtimeEnv, ctx) =>
  createQueueDispatcher(MESSAGE_HANDLERS, MODULES).dispatch(
    batch,
    runtimeEnv,
    ctx,
  );

// retry()は遅延の指定を記録しないため、ack・retryの状態はgetQueueResultで、遅延秒数はretryの呼び出しの引数で確かめる
async function dispatch(
  envelope: QueueEnvelope,
  options: { readonly attempts?: number; readonly handler?: QueueHandler } = {},
): Promise<MessageOutcome> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    {
      id: envelope.id,
      timestamp: T0,
      attempts: options.attempts ?? 1,
      body: envelope,
    },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const retrySpy = vi.spyOn(message, 'retry');
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  const ctx = createExecutionContext();
  await (options.handler ?? defaultQueueHandler)(batch, env, ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  // 封筒や本文の不正でデッドレターへ移ったメッセージもackされるため、処理まで届いたことを確かめる
  expect(deadLetterSpy).not.toHaveBeenCalled();
  const retried = retryMessages.some(({ msgId }) => msgId === message.id);
  const delaySeconds = retrySpy.mock.calls.at(-1)?.[0]?.delaySeconds;
  return {
    acked: explicitAcks.includes(message.id),
    retried,
    ...(retried && delaySeconds !== undefined ? { delaySeconds } : {}),
  };
}

interface FakeHandlerCall {
  readonly name: string;
  readonly activation: UltrasActivation;
}

// eventのUltrasのモジュールだけを偽の登録で組み立て直し、偽の処理の束縛を加えた一覧で本番と同じconsumerを動かす
function createFakeQueueHandler(
  calls: FakeHandlerCall[],
  secondFailures: { remaining: number },
): QueueHandler {
  const fakeHandler = (
    name: string,
    fail: () => boolean,
  ): UltrasActivationHandler => ({
    handle: (activation) => {
      calls.push({ name, activation });
      return fail()
        ? Promise.reject(new Error(`${name}の失敗`))
        : Promise.resolve();
    },
  });
  const fakes = {
    name: 'fake-ultras-activation-handlers',
    bindings: new ContainerModule(({ bind }) => {
      bind<UltrasActivationHandler>(FIRST).toConstantValue(
        fakeHandler('first', () => false),
      );
      bind<UltrasActivationHandler>(SECOND).toConstantValue(
        fakeHandler('second', () => {
          if (secondFailures.remaining === 0) {
            return false;
          }
          secondFailures.remaining -= 1;
          return true;
        }),
      );
    }),
  };
  const modules = [
    ...MODULES.map((module) =>
      module === EVENT_ULTRAS_MODULE
        ? createEventUltrasModule({ activationHandlers: FAKE_REGISTRATIONS })
        : module,
    ),
    fakes,
  ];
  const dispatcher = createQueueDispatcher(MESSAGE_HANDLERS, modules);
  return (batch, runtimeEnv, ctx) =>
    dispatcher.dispatch(batch, runtimeEnv, ctx);
}

async function insertActivatedUserWithActivation(): Promise<void> {
  await insertUser(1);
  await insertSubscriptionRow(activatedSubscriptionRow(1));
  await insertActivationRow(newActivationRow(1, { id: ACTIVATION_ID }));
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearUltrasTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('イベントサーバーのモジュールの一覧へのUltrasの登録', () => {
  test('Ultrasの共通の束縛と、それが使う決済・メール・利用者の共通の束縛を1つずつ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    for (const name of [
      'ultras-platform',
      'payments-platform',
      'email-platform',
      'identity-platform',
    ]) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
    }
  });

  test('eventのUltrasのモジュールを、Ultrasの共通の束縛の後に1つだけ持つ', () => {
    expect(
      MODULES.filter((module) => module === EVENT_ULTRAS_MODULE),
    ).toHaveLength(1);
    expect(MODULES.indexOf(EVENT_ULTRAS_MODULE)).toBeGreaterThan(
      MODULES.indexOf(EVENT_ULTRAS_PLATFORM_MODULE),
    );
    expect(EVENT_ULTRAS_MODULE.name).toBe('event-ultras');
  });

  test('解決を確かめる識別子はULTRAS_TYPESの全てである', () => {
    expect(IMPLEMENTATIONS.map(([name]) => name).toSorted()).toEqual(
      Object.keys(ULTRAS_TYPES).toSorted(),
    );
  });

  test.each(IMPLEMENTATIONS)(
    'モジュールの一覧の処理単位のコンテナから%sを解決する',
    (name, implementation) => {
      expect(createContainer().get(ULTRAS_TYPES[name])).toBeInstanceOf(
        implementation,
      );
    },
  );

  test.each([
    ['SubscriptionStore', 'SubscriptionStatements'],
    ['ActivationStore', 'ActivationStatements'],
    ['NoticeStore', 'NoticeStatements'],
  ] as const)(
    '%sと%sは同じインスタンスに解決される',
    (operations, statements) => {
      const container = createContainer();

      expect(container.get(ULTRAS_TYPES[statements])).toBe(
        container.get(ULTRAS_TYPES[operations]),
      );
    },
  );

  test('モジュールの一覧の処理単位のコンテナから加入が有効になった知らせの処理を解決する', () => {
    expect(
      createContainer().get(EVENT_ULTRAS_TYPES.RunActivationHandlersHandler),
    ).toBeInstanceOf(RunActivationHandlersHandler);
  });

  test.each([
    ['SubscriptionCancellationHandler', SubscriptionCancellationHandler],
    ['SubscriptionErasureHandler', SubscriptionErasureHandler],
    ['UltrasAccountDataEraser', D1UltrasAccountDataEraser],
  ] as const)(
    'モジュールの一覧の処理単位のコンテナから%sを解決する',
    (name, implementation) => {
      expect(createContainer().get(EVENT_ULTRAS_TYPES[name])).toBeInstanceOf(
        implementation,
      );
    },
  );
});

describe('退会・停止の解約と物理削除の波及処理の登録', () => {
  test('退会・停止に順序500の解約を、物理削除の開始に順序500の削除を登録し、停止の解除には登録しない', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('ultras-subscription.'),
      ),
    ).toStrictEqual([
      {
        name: 'ultras-subscription.subscription-cancellation',
        events: ['withdrawn', 'suspended'],
        order: 500,
        handler: EVENT_ULTRAS_TYPES.SubscriptionCancellationHandler,
      },
      {
        name: 'ultras-subscription.subscription-erasure',
        events: ['purge_due'],
        order: 500,
        handler: EVENT_ULTRAS_TYPES.SubscriptionErasureHandler,
      },
    ]);
  });

  test('登録の検証を通り、paymentsの波及処理の後・アカウント機能の波及処理の前に並ぶ', () => {
    const registry = createAsyncLifecycleRegistry(
      USER_LIFECYCLE_ASYNC_HANDLERS,
    );
    const namesFor = (
      type: 'purge_due' | 'withdrawn' | 'suspended' | 'unsuspended',
    ) => registry.handlersFor(type).map(({ name }) => name);

    expect(namesFor('withdrawn')).toStrictEqual([
      'payments.open-checkout-expiry',
      'ultras-subscription.subscription-cancellation',
      'identity-auth.email-suppression-cleanup',
    ]);
    expect(namesFor('suspended')).toStrictEqual([
      'payments.open-checkout-expiry',
      'ultras-subscription.subscription-cancellation',
      'user-profile-social.owned-image-quarantine',
    ]);
    expect(namesFor('purge_due')).toStrictEqual([
      'inquiry-chat.member-inquiry-purge',
      'payments.customer-erasure',
      'ultras-subscription.subscription-erasure',
      'user-profile-social.profile-erasure',
      'user-profile-social.owned-file-erasure',
      'product-launch.product-erasure',
    ]);
    expect(
      namesFor('unsuspended').filter((name) =>
        name.startsWith('ultras-subscription.'),
      ),
    ).toStrictEqual([]);
  });
});

describe('加入が有効になった知らせの処理の登録箇所', () => {
  test('初版の登録箇所は空の凍結済みの配列で、登録の検証を通る', () => {
    expect(ULTRAS_ACTIVATION_HANDLERS).toEqual([]);
    expect(Object.isFrozen(ULTRAS_ACTIVATION_HANDLERS)).toBe(true);
    expect(createUltrasActivationRegistry(ULTRAS_ACTIVATION_HANDLERS)).toEqual(
      [],
    );
  });

  test('orderが重複した登録は、最初のメッセージではなくモジュールの組み立ての時点で例外になる', () => {
    expect(() =>
      createEventUltrasModule({
        activationHandlers: [
          { name: 'ultras-test.first', order: 100, handler: FIRST },
          { name: 'ultras-test.second', order: 100, handler: SECOND },
        ],
      }),
    ).toThrow(UltrasActivationRegistrationError);
  });
});

describe('加入が有効になった知らせのメッセージの処理の登録', () => {
  test('ultras.run-activation-handlersを知らせの処理へ、最大5回の再試行の方針で登録する', () => {
    expect(
      MESSAGE_HANDLERS.filter(
        ({ contract }) =>
          contract.type === ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE.type,
      ),
    ).toStrictEqual([
      {
        contract: ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE,
        handler: EVENT_ULTRAS_TYPES.RunActivationHandlersHandler,
        retry: ULTRAS_ACTIVATION_RETRY_POLICY,
      },
    ]);
    expect(ULTRAS_ACTIVATION_RETRY_POLICY.maxAttempts).toBe(5);
    expect(() =>
      createQueueDispatcher(MESSAGE_HANDLERS, MODULES),
    ).not.toThrow();
  });
});

describe('加入が有効になった知らせのメッセージの処理', () => {
  test('登録が空の初版でも、知らせの行に完了を記録してackし、同じ知らせの再配信は完了の時刻を変えずにackする', async () => {
    await insertActivatedUserWithActivation();
    const envelope = activationEnvelope(ACTIVATION_ID);

    const first = await dispatch(envelope);
    const completed = await readActivationRow(ACTIVATION_ID);

    expect(first).toStrictEqual({ acked: true, retried: false });
    expect(completed?.completedAt).toBeInstanceOf(Date);

    const second = await dispatch(envelope, { attempts: 2 });

    expect(second).toStrictEqual({ acked: true, retried: false });
    expect(await readActivationRow(ACTIVATION_ID)).toMatchObject({
      completedAt: completed?.completedAt,
    });
  });

  test('知らせの行が無いメッセージは何もせずにackする', async () => {
    const outcome = await dispatch(activationEnvelope(ACTIVATION_ID));

    expect(outcome).toStrictEqual({ acked: true, retried: false });
  });

  test('登録のorderの昇順に処理へ利用者・加入・有効になった時刻を渡し、すべて成功したら完了を記録する', async () => {
    const calls: FakeHandlerCall[] = [];
    const handler = createFakeQueueHandler(calls, { remaining: 0 });
    await insertActivatedUserWithActivation();

    const outcome = await dispatch(activationEnvelope(ACTIVATION_ID), {
      handler,
    });

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    const activation: UltrasActivation = {
      activationId: ACTIVATION_ID,
      userId: userIdOf(1),
      stripeSubscriptionId: stripeSubscriptionIdOf(1),
      activatedAt: T0,
    };
    expect(calls).toEqual([
      { name: 'first', activation },
      { name: 'second', activation },
    ]);
    expect(
      (await readActivationRow(ACTIVATION_ID))?.completedAt,
    ).toBeInstanceOf(Date);
  });

  test('処理の1つが失敗したら完了を記録せずに本specの再試行の方針で再試行し、再配信ですべての処理を呼び直して完了する', async () => {
    const calls: FakeHandlerCall[] = [];
    const handler = createFakeQueueHandler(calls, { remaining: 1 });
    await insertActivatedUserWithActivation();
    const envelope = activationEnvelope(ACTIVATION_ID);
    const expected = decideOnFailure(ULTRAS_ACTIVATION_RETRY_POLICY, 1);
    if (expected.kind !== 'retry') {
      throw new Error('1回目の失敗は再試行になるはず');
    }

    const first = await dispatch(envelope, { attempts: 1, handler });

    expect(first).toStrictEqual({
      acked: false,
      retried: true,
      delaySeconds: expected.delaySeconds,
    });
    expect(expected.delaySeconds).toBe(
      ULTRAS_ACTIVATION_RETRY_POLICY.baseDelaySeconds,
    );
    expect(calls.map(({ name }) => name)).toEqual(['first', 'second']);
    expect((await readActivationRow(ACTIVATION_ID))?.completedAt).toBeNull();

    const second = await dispatch(envelope, { attempts: 2, handler });

    expect(second).toStrictEqual({ acked: true, retried: false });
    expect(calls.map(({ name }) => name)).toEqual([
      'first',
      'second',
      'first',
      'second',
    ]);
    expect(
      (await readActivationRow(ACTIVATION_ID))?.completedAt,
    ).toBeInstanceOf(Date);
  });
});
