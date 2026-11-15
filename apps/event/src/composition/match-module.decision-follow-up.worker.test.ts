import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
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

import {
  createAsyncLifecycleRegistry,
  type UserLifecycleAsyncHandler,
} from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import { RUN_MATCH_EVENT_MESSAGE } from '../../lib/core/messaging/contracts/match.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/product.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type {
  LaunchRecord,
  ProductDirectory,
} from '../../lib/core/product/ports.ts';
import {
  createProductLifecycleRegistry,
  type ProductLifecycleAsyncHandler,
} from '../../lib/core/product/product-lifecycle.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearDirectoryTables } from '../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  eventIdOf,
  insertEvent,
  readEvent,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  AFTER_DECISION,
  DECIDED_AT,
  seedDirectoryOwners,
  settledQualifier,
  STARTS_AT,
} from '../../lib/workers/match/testing/directory-fixtures.ts';
import {
  insertMatchEvents,
  readMatchEvents,
} from '../../lib/workers/match/testing/event-fixtures.ts';
import {
  insertMatch,
  matchIdOf,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import {
  insertProductEvent,
  launchIdOf,
  productEventIdOf,
  productIdOf,
  readProductEvent,
  T0,
  userIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import {
  AccountDecisionFollowUpHandler,
  ProductDecisionFollowUpHandler,
} from '../application/match/decision-follow-up-handlers.ts';
import { EVENT_MATCH_TYPES } from '../application/match/event-match-types.ts';
import worker from '../index.ts';
import { MODULES } from './modules.ts';
import { PRODUCT_LIFECYCLE_ASYNC_HANDLERS } from './product-lifecycle-async-handlers.ts';
import { dispatchMatchEvent } from './testing/match-event-queue.ts';
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

interface LifecycleOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly matchEnvelopes: readonly QueueEnvelope[];
}

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const ACCOUNT_HANDLER_NAME = 'match-engine.account-decision-follow-up';

const PRODUCT_HANDLER_NAME = 'match-engine.product-decision-follow-up';

const INVOCATION_KINDS = ['fetch', 'scheduled', 'queue'] as const;

const EARLY_END_MATCH = 2;

const LIFECYCLE_EVENT = 10;

const EARLY_ENDED_AT = new Date(STARTS_AT.getTime() + 3_600_000);

function createContainer(
  kind: (typeof INVOCATION_KINDS)[number] = 'queue',
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: { kind, correlationId: crypto.randomUUID(), clientIp: undefined },
    },
    MODULES,
  );
}

let envelopeCount = 0;

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function lifecycleEnvelope(type: string, eventId: string): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type,
    id: `01JD0MFXP${String(envelopeCount).padStart(17, '0')}`,
    sentAt: T0.toISOString(),
    body: { eventId },
  };
}

function isMatchEventEnvelope(sent: unknown): sent is QueueEnvelope {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === RUN_MATCH_EVENT_MESSAGE.type
  );
}

// 本番と同じエントリのqueueハンドラーで処理する。マッチイベントのメッセージも同じキューへ送られるため、実際には送らずに集めて後でマッチイベントの処理へ渡す
async function dispatchLifecycle(
  envelope: QueueEnvelope,
): Promise<LifecycleOutcome> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: T0, attempts: 1, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const { queue } = worker;
  if (queue === undefined) {
    throw new Error('イベントサーバーのエントリにqueueハンドラーが無い');
  }
  const sendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  const ctx = createExecutionContext();
  try {
    await queue(batch, env, ctx);
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    // 封筒や本文の不正でデッドレターへ移ったメッセージもackされるため、処理まで届いたことを確かめる
    expect(deadLetterSpy).not.toHaveBeenCalled();
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      matchEnvelopes: sendSpy.mock.calls
        .map(([sent]) => sent)
        .filter(isMatchEventEnvelope),
    };
  } finally {
    sendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

async function readLaunch(
  productIndex: number,
  launchIndex: number,
): Promise<LaunchRecord | undefined> {
  const launches = await createContainer()
    .get<ProductDirectory>(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    .listLaunches([productIdOf(productIndex)], AFTER_DECISION);
  return launches
    .get(productIdOf(productIndex))
    ?.find(({ launchId }) => launchId === launchIdOf(launchIndex));
}

// 利用者2(プロダクト4)の退会・停止またはプロダクト4の非公開化・削除で、開始から1時間で即時に終了した予選。即時の終了は確定のイベントを作らない
async function insertEarlyEndedMatch(): Promise<void> {
  await insertMatch({
    index: EARLY_END_MATCH,
    columns: {
      startedAt: STARTS_AT,
      decidedAt: EARLY_ENDED_AT,
      endedEarlyAt: EARLY_ENDED_AT,
      decision: 'walkover',
    },
    entries: [
      {
        index: 21,
        launch: 2,
        product: 2,
        owner: 1,
        columns: { result: 'walkover' },
      },
      {
        index: 22,
        launch: 4,
        product: 4,
        owner: 2,
        columns: { result: 'lost', forfeitedAt: EARLY_ENDED_AT },
      },
    ],
  });
}

// 23:40の確定で確定のイベントが作られ、処理を終えた予選
async function insertSettledMatchWithEvent(): Promise<void> {
  await insertMatch(settledQualifier(1));
  await insertMatchEvents([
    {
      index: 1,
      match: 1,
      type: 'decided',
      occurredAt: DECIDED_AT,
      columns: { status: 'completed', completedAt: DECIDED_AT },
    },
  ]);
}

async function decidedEventsOf(matchIndex: number) {
  return (await readMatchEvents()).filter(
    ({ matchId, type }) =>
      matchId === matchIdOf(matchIndex) && type === 'decided',
  );
}

// 後続の処理が送ったマッチイベントを本番と同じconsumerで処理する
async function deliverMatchEvents(
  envelopes: readonly QueueEnvelope[],
): Promise<void> {
  for (const envelope of envelopes) {
    await expect(dispatchMatchEvent(envelope)).resolves.toStrictEqual({
      acked: true,
      retried: false,
    });
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearDirectoryTables();
  await seedDirectoryOwners();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('即時の終了の後続の処理の登録', () => {
  test('ユーザーの退会・停止に帯の1100で登録し、登録の検証を通って他の機能の波及処理の後・アカウント機能の波及処理の前に並ぶ', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(
        ({ name }) => name === ACCOUNT_HANDLER_NAME,
      ),
    ).toStrictEqual([
      {
        name: ACCOUNT_HANDLER_NAME,
        events: ['withdrawn', 'suspended'],
        order: 1100,
        handler: EVENT_MATCH_TYPES.AccountDecisionFollowUpHandler,
      },
    ]);
    const registry = createAsyncLifecycleRegistry(
      USER_LIFECYCLE_ASYNC_HANDLERS,
    );
    expect(
      registry.handlersFor('withdrawn').map(({ name }) => name),
    ).toStrictEqual([
      'payments.open-checkout-expiry',
      'ultras-subscription.subscription-cancellation',
      ACCOUNT_HANDLER_NAME,
      'identity-auth.email-suppression-cleanup',
    ]);
    expect(
      registry.handlersFor('suspended').map(({ name }) => name),
    ).toStrictEqual([
      'payments.open-checkout-expiry',
      'ultras-subscription.subscription-cancellation',
      'user-profile-social.owned-image-quarantine',
      ACCOUNT_HANDLER_NAME,
    ]);
  });

  test('プロダクトの非公開化・削除に帯の1100で登録し、登録の検証を通ってproduct-launchの処理の後に並ぶ', () => {
    expect(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS.filter(
        ({ name }) => name === PRODUCT_HANDLER_NAME,
      ),
    ).toStrictEqual([
      {
        name: PRODUCT_HANDLER_NAME,
        events: ['hidden', 'deleted'],
        order: 1100,
        handler: EVENT_MATCH_TYPES.ProductDecisionFollowUpHandler,
      },
    ]);
    const registry = createProductLifecycleRegistry(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS,
    );
    expect(
      registry.handlersFor('hidden').map(({ name }) => name),
    ).toStrictEqual(['product-launch.image-quarantine', PRODUCT_HANDLER_NAME]);
    expect(
      registry.handlersFor('deleted').map(({ name }) => name),
    ).toStrictEqual([PRODUCT_HANDLER_NAME]);
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、2つの後続の処理を実装のクラスに解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(
        container.get<UserLifecycleAsyncHandler>(
          EVENT_MATCH_TYPES.AccountDecisionFollowUpHandler,
        ),
      ).toBeInstanceOf(AccountDecisionFollowUpHandler);
      expect(
        container.get<ProductLifecycleAsyncHandler>(
          EVENT_MATCH_TYPES.ProductDecisionFollowUpHandler,
        ),
      ).toBeInstanceOf(ProductDecisionFollowUpHandler);
    },
  );
});

describe('ユーザーの退会・停止の後続の処理(match-engine.account-decision-follow-up)', () => {
  test.each(['withdrawn', 'suspended'] as const)(
    '%sのイベントの処理で即時に終了したマッチに確定のイベントを作って送り、その処理で予選の結果がローンチに記録される',
    async (type) => {
      await insertEarlyEndedMatch();
      await insertEvent(LIFECYCLE_EVENT, {
        userId: userIdOf(2),
        type,
        occurredAt: EARLY_ENDED_AT,
      });

      const outcome = await dispatchLifecycle(
        lifecycleEnvelope(
          RUN_USER_LIFECYCLE_MESSAGE.type,
          eventIdOf(LIFECYCLE_EVENT),
        ),
      );

      expect(outcome).toMatchObject({ acked: true, retried: false });
      await expect(readEvent(LIFECYCLE_EVENT)).resolves.toMatchObject({
        status: 'completed',
      });
      const created = await decidedEventsOf(EARLY_END_MATCH);
      expect(created).toMatchObject([
        { occurredAt: EARLY_ENDED_AT, status: 'pending' },
      ]);
      expect(outcome.matchEnvelopes.map(({ body }) => body)).toStrictEqual(
        created.map(({ id }) => ({ eventId: id })),
      );

      await deliverMatchEvents(outcome.matchEnvelopes);

      await expect(readLaunch(2, 2)).resolves.toMatchObject({
        status: 'finished',
        outcome: 'won',
        decidedAt: EARLY_ENDED_AT,
      });
      await expect(readLaunch(4, 4)).resolves.toMatchObject({
        status: 'finished',
        outcome: 'lost',
        decidedAt: EARLY_ENDED_AT,
      });
      await expect(decidedEventsOf(EARLY_END_MATCH)).resolves.toMatchObject([
        { status: 'completed' },
      ]);
    },
  );
});

describe('プロダクトの非公開化・削除の後続の処理(match-engine.product-decision-follow-up)', () => {
  test.each(['hidden', 'deleted'] as const)(
    '%sのイベントの処理で即時に終了したマッチに確定のイベントを作って送り、その処理で予選の結果がローンチに記録される',
    async (type) => {
      await insertEarlyEndedMatch();
      await insertProductEvent(LIFECYCLE_EVENT, 4, {
        ownerUserId: userIdOf(2),
        type,
        occurredAt: EARLY_ENDED_AT,
      });

      const outcome = await dispatchLifecycle(
        lifecycleEnvelope(
          RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
          productEventIdOf(LIFECYCLE_EVENT),
        ),
      );

      expect(outcome).toMatchObject({ acked: true, retried: false });
      await expect(readProductEvent(LIFECYCLE_EVENT)).resolves.toMatchObject({
        status: 'completed',
      });
      expect(outcome.matchEnvelopes).toHaveLength(1);

      await deliverMatchEvents(outcome.matchEnvelopes);

      await expect(readLaunch(2, 2)).resolves.toMatchObject({
        status: 'finished',
        outcome: 'won',
        decidedAt: EARLY_ENDED_AT,
      });
      await expect(readLaunch(4, 4)).resolves.toMatchObject({
        status: 'finished',
        outcome: 'lost',
        decidedAt: EARLY_ENDED_AT,
      });
    },
  );
});

describe('後続の処理の冪等性', () => {
  test('確定のイベントのあるマッチには作らず、2回呼んでも即時に終了したマッチの確定のイベントは1件である', async () => {
    await insertSettledMatchWithEvent();
    await insertEarlyEndedMatch();
    const handler = createContainer().get<UserLifecycleAsyncHandler>(
      EVENT_MATCH_TYPES.AccountDecisionFollowUpHandler,
    );
    const event = {
      id: eventIdOf(LIFECYCLE_EVENT),
      userId: userIdOf(2),
      type: 'withdrawn',
      occurredAt: EARLY_ENDED_AT,
    } as const;
    const sendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    });

    await expect(handler.handle(event)).resolves.toStrictEqual({
      kind: 'done',
    });
    await expect(handler.handle(event)).resolves.toStrictEqual({
      kind: 'done',
    });

    await expect(decidedEventsOf(1)).resolves.toHaveLength(1);
    await expect(decidedEventsOf(EARLY_END_MATCH)).resolves.toHaveLength(1);
    expect(
      sendSpy.mock.calls.map(([sent]) => sent).filter(isMatchEventEnvelope),
    ).toHaveLength(1);
  });
});
