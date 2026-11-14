import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import {
  EXPAND_NOTIFICATION_EVENT_MESSAGE,
  FLUSH_NOTIFICATION_SLOT_MESSAGE,
  NOTIFICATION_RETRY_POLICY,
} from '../../lib/core/messaging/contracts/notifications.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { awardSlot } from '../../lib/core/notifications/notification-slots.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import { insertProduct } from '../../lib/workers/product/testing/product-fixtures.ts';
import {
  awardProductIdOf,
  insertEventRow,
  seedAwardFollowers,
} from '../../lib/workers/notifications/testing/notification-event-fixtures.ts';
import {
  after,
  insertUser,
  readEventRows,
  readNoticeRows,
  readSlotRow,
  T0,
  userIdOf,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { EVENT_NOTIFICATIONS_TYPES } from '../application/notifications/event-notifications-types.ts';
import { resetDispatchTables } from '../infrastructure/notifications/testing/group-dispatcher-fixtures.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';
import { MODULES } from './modules.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const EVENT_ID = `01JC0EVNT${'1'.padStart(17, '0')}`;
const AWARD_OWNER = 1;
const AWARD_PRODUCT = 11;
const AWARD_SLOT_KEY = awardSlot(EVENT_ID, T0).key;
const NOW = after(60_000);

// 1回の処理で展開する上限(2,000件)を1件だけ超えるフォロワーの数
const FOLLOWERS_OVER_BUDGET = 2001;

const MAX_ROUNDS = 5;

const EXPAND_ENVELOPE: QueueEnvelope = {
  v: 1,
  type: EXPAND_NOTIFICATION_EVENT_MESSAGE.type,
  id: '01JD0NTFY00000000000000003',
  sentAt: T0.toISOString(),
  body: { eventId: EVENT_ID },
};

interface SentEnvelope {
  readonly envelope: QueueEnvelope;
  readonly delaySeconds: number | undefined;
}

interface Round {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly resentDelaySeconds: number | undefined;
}

function isEnvelopeOf(type: string, sent: unknown): sent is QueueEnvelope {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === type
  );
}

// 本番と同じQueueのconsumer・メッセージの処理の一覧・モジュールの一覧で1件を処理し、Queueへ送られた封筒を記録する
async function deliver(
  envelope: QueueEnvelope,
  sent: SentEnvelope[],
): Promise<Round> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    { id: envelope.id, timestamp: T0, attempts: 1, body: envelope },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  // 続きの再送と送り出しの依頼が後のテストの途中で届かないよう、実際には送らない
  const sendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  const ctx = createExecutionContext();
  try {
    await createQueueDispatcher(MESSAGE_HANDLERS, MODULES).dispatch(
      batch,
      env,
      ctx,
    );
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    expect(deadLetterSpy).not.toHaveBeenCalled();
    const calls = sendSpy.mock.calls.map(([body, options]) => ({
      envelope: body as QueueEnvelope,
      delaySeconds: options?.delaySeconds,
    }));
    sent.push(...calls);
    const resend = calls
      .filter(({ envelope: sentEnvelope }) =>
        isEnvelopeOf(EXPAND_NOTIFICATION_EVENT_MESSAGE.type, sentEnvelope),
      )
      .at(-1);
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      resentDelaySeconds: resend?.delaySeconds,
    };
  } finally {
    sendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

// 遅延再送された同じ封筒を、送り直されなくなるまで処理し直す
async function deliverUntilSettled(sent: SentEnvelope[]): Promise<Round[]> {
  const rounds: Round[] = [];
  for (let index = 0; index < MAX_ROUNDS; index += 1) {
    const round = await deliver(EXPAND_ENVELOPE, sent);
    rounds.push(round);
    if (round.resentDelaySeconds === undefined) {
      return rounds;
    }
  }
  throw new Error('受賞の展開が終わらない');
}

function flushRequestsOf(sent: readonly SentEnvelope[]) {
  return sent.flatMap(({ envelope, delaySeconds }) =>
    isEnvelopeOf(FLUSH_NOTIFICATION_SLOT_MESSAGE.type, envelope)
      ? [{ body: envelope.body, delaySeconds }]
      : [],
  );
}

// 受賞したプロダクトの投稿者と、受賞結果を受信するフォロワーを作り、未展開の受賞の通知イベントを記録する
async function seedAward(followerIndexes: readonly number[]): Promise<void> {
  await insertUser(AWARD_OWNER, { emailVerifiedAt: T0 });
  await insertProduct(AWARD_PRODUCT, AWARD_OWNER, {
    id: awardProductIdOf(AWARD_PRODUCT),
  });
  await seedAwardFollowers(AWARD_OWNER, followerIndexes);
  await insertEventRow({
    id: EVENT_ID,
    type: 'award',
    dedupeKey: `award:product_of_the_week:2026-W47:${awardProductIdOf(AWARD_PRODUCT)}`,
    publisher: 'tournament-week',
    award: 'product_of_the_week',
    period: '2026-W47',
    productId: awardProductIdOf(AWARD_PRODUCT),
    occurredAt: T0,
    lastDispatchedAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
}

function rangeOf(first: number, count: number): number[] {
  return Array.from({ length: count }, (_, offset) => first + offset);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // 本番のQueueの経路は処理の時刻をシステムの時計から読むため、受賞の枠の依頼の時刻を確かめられるよう固定する
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await resetDispatchTables();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('受賞の展開のメッセージの処理の登録', () => {
  test('notifications.expand-eventを受賞の展開の処理へ、通知の再試行の方針で登録する', () => {
    expect(
      MESSAGE_HANDLERS.filter(
        ({ contract }) =>
          contract.type === EXPAND_NOTIFICATION_EVENT_MESSAGE.type,
      ),
    ).toStrictEqual([
      {
        contract: EXPAND_NOTIFICATION_EVENT_MESSAGE,
        handler: EVENT_NOTIFICATIONS_TYPES.ExpandEventHandler,
        retry: NOTIFICATION_RETRY_POLICY,
      },
    ]);
    expect(() =>
      createQueueDispatcher(MESSAGE_HANDLERS, MODULES),
    ).not.toThrow();
  });
});

describe('notifications.expand-eventのQueueの処理', () => {
  test('受賞をフォロワーの通知へ展開し、受賞の枠の送り出しを遅延0秒で依頼して完了する', async () => {
    await seedAward([101, 102]);
    const sent: SentEnvelope[] = [];

    const rounds = await deliverUntilSettled(sent);

    expect(rounds).toStrictEqual([
      { acked: true, retried: false, resentDelaySeconds: undefined },
    ]);
    expect(flushRequestsOf(sent)).toStrictEqual([
      { body: { slotKey: AWARD_SLOT_KEY }, delaySeconds: 0 },
    ]);
    expect(
      (await readNoticeRows())
        .map((row) => [row.recipientUserId, row.slotKey, row.status])
        .toSorted(),
    ).toStrictEqual([
      [userIdOf(101), AWARD_SLOT_KEY, 'pending'],
      [userIdOf(102), AWARD_SLOT_KEY, 'pending'],
    ]);
    expect(await readSlotRow(AWARD_SLOT_KEY)).toMatchObject({
      kind: 'award',
      dispatchRequestedAt: NOW,
    });
    expect(await readEventRows()).toStrictEqual([
      expect.objectContaining({ status: 'expanded', expandedAt: NOW }),
    ]);
  });

  test('1回の上限を超えるフォロワーは続きの1秒の遅延再送で展開し、完了の後に1回だけ送り出しを依頼する', async () => {
    await seedAward(rangeOf(1001, FOLLOWERS_OVER_BUDGET));
    const sent: SentEnvelope[] = [];

    const rounds = await deliverUntilSettled(sent);

    expect(rounds).toStrictEqual([
      { acked: true, retried: false, resentDelaySeconds: 1 },
      { acked: true, retried: false, resentDelaySeconds: undefined },
    ]);
    expect(flushRequestsOf(sent)).toStrictEqual([
      { body: { slotKey: AWARD_SLOT_KEY }, delaySeconds: 0 },
    ]);
    expect(await readNoticeRows()).toHaveLength(FOLLOWERS_OVER_BUDGET);
  });

  test('展開済みの受賞へ同じメッセージが再び届いても、通知を増やさずに受賞の枠の送り出しを依頼し直す', async () => {
    await seedAward([101]);
    await deliverUntilSettled([]);
    const sent: SentEnvelope[] = [];

    const rounds = await deliverUntilSettled(sent);

    expect(rounds).toStrictEqual([
      { acked: true, retried: false, resentDelaySeconds: undefined },
    ]);
    expect(flushRequestsOf(sent)).toStrictEqual([
      { body: { slotKey: AWARD_SLOT_KEY }, delaySeconds: 0 },
    ]);
    expect(await readNoticeRows()).toHaveLength(1);
  });
});
