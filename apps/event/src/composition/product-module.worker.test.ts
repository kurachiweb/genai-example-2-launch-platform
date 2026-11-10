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

import { LifecycleRegistrationError } from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/product.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import {
  createProductLifecycleRegistry,
  PRODUCT_LIFECYCLE_RETRY_POLICY,
  type ProductLifecycleAsyncHandler,
  type ProductLifecycleAsyncRegistration,
  type ProductLifecycleEvent,
  type ProductLifecycleEventType,
} from '../../lib/core/product/product-lifecycle.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import {
  clearProductTables,
  insertLaunch,
  insertProduct,
  insertProductEvent,
  insertProductPreviousHandle,
  insertScreenshot,
  insertUser,
  productEventIdOf,
  productIdOf,
  readProductEvent,
  readProductEventsOf,
  readProductHandlerRuns,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { EVENT_PRODUCT_TYPES } from '../application/product/event-product-types.ts';
import type { ProductPurgeStore } from '../application/product/ports.ts';
import { ProductImageErasureHandler } from '../application/product/product-image-erasure-handler.ts';
import { ProductImageQuarantineHandler } from '../application/product/product-image-quarantine-handler.ts';
import {
  PRODUCT_LIFECYCLE_ORDER_WAIT_SECONDS,
  ProductLifecycleRunner,
} from '../application/product/product-lifecycle-runner.ts';
import { D1ProductPurgeStore } from '../infrastructure/product/d1-product-purge-store.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';
import { MODULES } from './modules.ts';
import { PRODUCT_LIFECYCLE_ASYNC_HANDLERS } from './product-lifecycle-async-handlers.ts';
import {
  createEventProductModule,
  EVENT_PRODUCT_MODULE,
} from './product-module.ts';

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
  readonly resentDelaySeconds?: number | undefined;
}

type QueueHandler = (
  batch: MessageBatch,
  env: Env,
  ctx: ExecutionContext,
) => Promise<void>;

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const INVOCATION_KINDS = ['fetch', 'scheduled', 'queue'] as const;

const OWNER = 1;

const PRODUCT = 1;

const OTHER_PRODUCT = 2;

const EVENT = 10;

const FIRST = Symbol.for('test.FirstProductLifecycleHandler');

const SECOND = Symbol.for('test.SecondProductLifecycleHandler');

// orderの降順に並べ、登録簿がorderの昇順に並べ直すことを確かめる
const FAKE_REGISTRATIONS: readonly ProductLifecycleAsyncRegistration[] = [
  {
    name: 'product-test.second',
    events: ['deleted', 'purge_due'],
    order: 200,
    handler: SECOND,
  },
  {
    name: 'product-test.first',
    events: ['deleted', 'purge_due'],
    order: 100,
    handler: FIRST,
  },
];

let envelopeCount = 0;

function createContainer(
  kind: (typeof INVOCATION_KINDS)[number] = 'queue',
): Container {
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

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function lifecycleEnvelope(eventId: string): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type: RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
    id: `01JD0PMSG${String(envelopeCount).padStart(17, '0')}`,
    sentAt: T0.toISOString(),
    body: { eventId },
  };
}

function isLifecycleEnvelope(sent: unknown): boolean {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === RUN_PRODUCT_LIFECYCLE_MESSAGE.type
  );
}

// 本番と同じQueueのconsumer・メッセージの処理の一覧・モジュールの一覧で処理する
const defaultQueueHandler: QueueHandler = (batch, runtimeEnv, ctx) =>
  createQueueDispatcher(MESSAGE_HANDLERS, MODULES).dispatch(
    batch,
    runtimeEnv,
    ctx,
  );

// retry()は遅延の指定を記録しないため、ack・retryの状態はgetQueueResultで、遅延秒数はretryの呼び出しの引数で確かめる。遅延の指定(defer)はackして同じ封筒を送り直すため、送り直しの遅延秒数をsendの呼び出しの引数で確かめる
async function dispatch(
  envelope: QueueEnvelope,
  handler: QueueHandler = defaultQueueHandler,
): Promise<MessageOutcome> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: T0, attempts: 1, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const retrySpy = vi.spyOn(message, 'retry');
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  // 続きの再送が後のテストの途中で届かないよう、実際には送らない
  const resendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  const ctx = createExecutionContext();
  try {
    await handler(batch, env, ctx);
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    // 封筒や本文の不正でデッドレターへ移ったメッセージもackされるため、処理まで届いたことを確かめる
    expect(deadLetterSpy).not.toHaveBeenCalled();
    const retried = retryMessages.some(({ msgId }) => msgId === message.id);
    const delaySeconds = retrySpy.mock.calls.at(-1)?.[0]?.delaySeconds;
    const resend = resendSpy.mock.calls
      .filter(([sent]) => isLifecycleEnvelope(sent))
      .at(-1);
    return {
      acked: explicitAcks.includes(message.id),
      retried,
      ...(retried && delaySeconds !== undefined ? { delaySeconds } : {}),
      ...(resend === undefined
        ? {}
        : { resentDelaySeconds: resend[1]?.delaySeconds }),
    };
  } finally {
    resendSpy.mockRestore();
  }
}

// eventのプロダクトのモジュールだけを偽の登録で組み立て直し、偽の処理の束縛を加えた一覧で本番と同じconsumerを動かす
function createFakeQueueHandler(
  calls: { readonly name: string; readonly event: ProductLifecycleEvent }[],
  failSecond: { remaining: number },
): QueueHandler {
  const fakeHandler = (
    name: string,
    fail: () => boolean,
  ): ProductLifecycleAsyncHandler => ({
    handle: (event) => {
      calls.push({ name, event });
      return fail()
        ? Promise.reject(new Error(`${name}の失敗`))
        : Promise.resolve({ kind: 'done' });
    },
  });
  const fakes = {
    name: 'fake-product-lifecycle-handlers',
    bindings: new ContainerModule(({ bind }) => {
      bind<ProductLifecycleAsyncHandler>(FIRST).toConstantValue(
        fakeHandler('first', () => false),
      );
      bind<ProductLifecycleAsyncHandler>(SECOND).toConstantValue(
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
      module === EVENT_PRODUCT_MODULE
        ? createEventProductModule({ asyncHandlers: FAKE_REGISTRATIONS })
        : module,
    ),
    fakes,
  ];
  const dispatcher = createQueueDispatcher(MESSAGE_HANDLERS, modules);
  return (batch, runtimeEnv, ctx) =>
    dispatcher.dispatch(batch, runtimeEnv, ctx);
}

async function insertDeletedProductWithRows(
  productIndex: number,
): Promise<void> {
  const base = productIndex * 10;
  await insertProduct(productIndex, OWNER, { deletedAt: T0 });
  await insertScreenshot(
    base + 1,
    productIndex,
    0,
    `01JD0SHOT${String(base + 1).padStart(17, '0')}`,
  );
  await insertLaunch(base + 1, productIndex, {
    launchDate: '2026-10-01',
    outcome: 'won',
    decidedAt: T0,
  });
  await insertProductPreviousHandle(
    base + 1,
    productIndex,
    `old${String(productIndex)}`,
    { deletedAt: T0 },
  );
}

async function productExists(productIndex: number): Promise<boolean> {
  const events = await readProductEventsOf(productIndex);
  const rows = await createContainer()
    .get<ProductPurgeStore>(EVENT_PRODUCT_TYPES.ProductPurgeStore)
    .imageFileIds(productIdOf(productIndex));
  return rows !== undefined || events.length > 0;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearProductTables();
  await insertUser(OWNER, { deletedAt: T0 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('イベントサーバーのモジュールの一覧へのプロダクトの登録', () => {
  test('eventのプロダクトのモジュールを、プロダクトの共通の束縛の後に1つだけ持つ', () => {
    const names = MODULES.map(({ name }) => name);

    expect(
      MODULES.filter((module) => module === EVENT_PRODUCT_MODULE),
    ).toHaveLength(1);
    expect(names.indexOf('event-product')).toBeGreaterThan(
      names.indexOf('product-platform'),
    );
    expect(EVENT_PRODUCT_MODULE.name).toBe('event-product');
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、物理削除のストア・実行器・画像の隔離と削除の処理を実装のクラスに解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(
        container.get<ProductPurgeStore>(EVENT_PRODUCT_TYPES.ProductPurgeStore),
      ).toBeInstanceOf(D1ProductPurgeStore);
      expect(
        container.get(EVENT_PRODUCT_TYPES.ProductLifecycleRunner),
      ).toBeInstanceOf(ProductLifecycleRunner);
      expect(
        container.get<ProductLifecycleAsyncHandler>(
          EVENT_PRODUCT_TYPES.ProductImageQuarantineHandler,
        ),
      ).toBeInstanceOf(ProductImageQuarantineHandler);
      expect(
        container.get<ProductLifecycleAsyncHandler>(
          EVENT_PRODUCT_TYPES.ProductImageErasureHandler,
        ),
      ).toBeInstanceOf(ProductImageErasureHandler);
    },
  );
});

describe('プロダクトライフサイクルの非同期の処理の登録口', () => {
  test('非公開化・復元に画像の隔離を、物理削除の時期の到来に画像の削除を、どちらも順序1000で凍結済みの配列に登録する', () => {
    expect(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('product-launch.'),
      ),
    ).toStrictEqual([
      {
        name: 'product-launch.image-quarantine',
        events: ['hidden', 'unhidden'],
        order: 1000,
        handler: EVENT_PRODUCT_TYPES.ProductImageQuarantineHandler,
      },
      {
        name: 'product-launch.image-erasure',
        events: ['purge_due'],
        order: 1000,
        handler: EVENT_PRODUCT_TYPES.ProductImageErasureHandler,
      },
    ]);
    expect(Object.isFrozen(PRODUCT_LIFECYCLE_ASYNC_HANDLERS)).toBe(true);
  });

  test('登録の検証を通り、種類ごとに本specの処理が帯の大きい他の機能の処理より前に並ぶ', () => {
    const registry = createProductLifecycleRegistry(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS,
    );
    const namesOf = (type: ProductLifecycleEventType) =>
      registry.handlersFor(type).map(({ name }) => name);

    expect(namesOf('hidden')).toStrictEqual([
      'product-launch.image-quarantine',
      'match-engine.product-decision-follow-up',
    ]);
    expect(namesOf('unhidden')).toStrictEqual([
      'product-launch.image-quarantine',
    ]);
    expect(namesOf('purge_due')).toStrictEqual([
      'product-launch.image-erasure',
    ]);
    expect(namesOf('deleted')).toStrictEqual([
      'match-engine.product-decision-follow-up',
    ]);
  });

  test('同じ種類でorderが重複した登録は、最初のメッセージではなくモジュールの組み立ての時点で例外になる', () => {
    expect(() =>
      createEventProductModule({
        asyncHandlers: [
          {
            name: 'product-test.first',
            events: ['hidden'],
            order: 100,
            handler: FIRST,
          },
          {
            name: 'product-test.second',
            events: ['hidden'],
            order: 100,
            handler: SECOND,
          },
        ],
      }),
    ).toThrow(LifecycleRegistrationError);
  });
});

describe('プロダクトライフサイクルのメッセージの処理の登録', () => {
  test('product.run-product-lifecycleを実行器へ、最大5回の再試行の方針で登録する', () => {
    expect(
      MESSAGE_HANDLERS.filter(
        ({ contract }) => contract.type === RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
      ),
    ).toStrictEqual([
      {
        contract: RUN_PRODUCT_LIFECYCLE_MESSAGE,
        handler: EVENT_PRODUCT_TYPES.ProductLifecycleRunner,
        retry: PRODUCT_LIFECYCLE_RETRY_POLICY,
      },
    ]);
    expect(PRODUCT_LIFECYCLE_RETRY_POLICY.maxAttempts).toBe(5);
    expect(() =>
      createQueueDispatcher(MESSAGE_HANDLERS, MODULES),
    ).not.toThrow();
  });
});

describe('プロダクトライフサイクルのメッセージの処理', () => {
  test('画像の記録が無くても、物理削除の時期の到来でプロダクトとその子の行・イベントを物理削除し、同じ投稿者の他のプロダクトは残す', async () => {
    await insertDeletedProductWithRows(PRODUCT);
    await insertDeletedProductWithRows(OTHER_PRODUCT);
    await insertProductEvent(EVENT, PRODUCT, {
      ownerUserId: userIdOf(OWNER),
      type: 'purge_due',
    });

    const outcome = await dispatch(lifecycleEnvelope(productEventIdOf(EVENT)));

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(productExists(PRODUCT)).resolves.toBe(false);
    await expect(productExists(OTHER_PRODUCT)).resolves.toBe(true);
  });

  test('物理削除の後に同じメッセージが再び届いても、何もせずackする', async () => {
    await insertDeletedProductWithRows(PRODUCT);
    await insertProductEvent(EVENT, PRODUCT, { type: 'purge_due' });
    const envelope = lifecycleEnvelope(productEventIdOf(EVENT));
    await dispatch(envelope);

    const again = await dispatch(envelope);

    expect(again).toStrictEqual({ acked: true, retried: false });
    await expect(productExists(PRODUCT)).resolves.toBe(false);
  });

  test('論理削除のイベントは処理の登録が無くても完了にし、プロダクトの行は残す', async () => {
    await insertDeletedProductWithRows(PRODUCT);
    await insertProductEvent(EVENT, PRODUCT, { type: 'deleted' });

    const outcome = await dispatch(lifecycleEnvelope(productEventIdOf(EVENT)));

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(readProductEvent(EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(productExists(PRODUCT)).resolves.toBe(true);
  });

  test('同じプロダクトのより前の未完了のイベントがあれば、処理せずに60秒後に再試行する', async () => {
    await insertDeletedProductWithRows(PRODUCT);
    await insertProductEvent(EVENT - 1, PRODUCT, {
      type: 'deleted',
      occurredAt: new Date(T0.getTime() - 60_000),
    });
    await insertProductEvent(EVENT, PRODUCT, { type: 'purge_due' });

    const outcome = await dispatch(lifecycleEnvelope(productEventIdOf(EVENT)));

    expect(outcome).toStrictEqual({
      acked: true,
      retried: false,
      resentDelaySeconds: PRODUCT_LIFECYCLE_ORDER_WAIT_SECONDS,
    });
    await expect(productExists(PRODUCT)).resolves.toBe(true);
  });

  test('登録した処理を順に呼んで完了を記録し、失敗した処理は再試行で完了した処理を飛ばして続け、全て終えてから物理削除する', async () => {
    await insertDeletedProductWithRows(PRODUCT);
    await insertProductEvent(EVENT, PRODUCT, {
      ownerUserId: userIdOf(OWNER),
      type: 'purge_due',
    });
    const calls: {
      readonly name: string;
      readonly event: ProductLifecycleEvent;
    }[] = [];
    const handler = createFakeQueueHandler(calls, { remaining: 1 });
    const envelope = lifecycleEnvelope(productEventIdOf(EVENT));

    const first = await dispatch(envelope, handler);

    expect(first).toMatchObject({ acked: false, retried: true });
    expect(calls.map(({ name }) => name)).toStrictEqual(['first', 'second']);
    expect(calls[0]?.event).toStrictEqual({
      id: productEventIdOf(EVENT),
      productId: productIdOf(PRODUCT),
      ownerUserId: userIdOf(OWNER),
      type: 'purge_due',
      occurredAt: T0,
    });
    await expect(readProductHandlerRuns()).resolves.toMatchObject([
      { eventId: productEventIdOf(EVENT), handlerName: 'product-test.first' },
    ]);
    await expect(productExists(PRODUCT)).resolves.toBe(true);

    const second = await dispatch(envelope, handler);

    expect(second).toStrictEqual({ acked: true, retried: false });
    expect(calls.map(({ name }) => name)).toStrictEqual([
      'first',
      'second',
      'second',
    ]);
    await expect(productExists(PRODUCT)).resolves.toBe(false);
    await expect(readProductHandlerRuns()).resolves.toStrictEqual([]);
  });
});
