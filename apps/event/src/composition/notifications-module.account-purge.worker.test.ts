import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
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

import { users } from '../../db/schema/identity/users.ts';
import { notificationNotices } from '../../db/schema/notifications/notification-notices.ts';
import { notificationPreferences } from '../../db/schema/notifications/notification-preferences.ts';
import {
  createAsyncLifecycleRegistry,
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  type UserLifecycleAsyncHandler,
} from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import type {
  NotificationPreferenceStore,
  UnsubscribeTokenService,
} from '../../lib/core/notifications/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  eventIdOf,
  insertEvent,
  readEvent,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  clearNotificationTables,
  db,
  insertRecipient,
  readUnsubscribeTokenRows,
  recipientIdOf,
  T0,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { AccountPurgeHandler } from '../application/notifications/account-purge-handler.ts';
import { EVENT_NOTIFICATIONS_TYPES } from '../application/notifications/event-notifications-types.ts';
import worker from '../index.ts';
import { MODULES } from './modules.ts';
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
  readonly resentDelaySeconds?: number | undefined;
}

type NoticeRow = typeof notificationNotices.$inferInsert;

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const HANDLER_NAME = 'notifications.account-purge';

const INVOCATION_KINDS = ['fetch', 'scheduled', 'queue'] as const;

const PURGED = 1;

const OTHER = 2;

const PURGE_EVENT = 10;

// 1回の処理で消す上限(1,000件)を1件だけ超える通知の数
const NOTICES_OVER_BATCH = 1001;

// 1行が11個のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const NOTICE_ROWS_PER_INSERT = 9;

const NOTICE_INSERTS_PER_BATCH = 50;

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形のIDを振る
const userEnvelope: QueueEnvelope = Object.freeze({
  v: 1,
  type: RUN_USER_LIFECYCLE_MESSAGE.type,
  id: '01JD0NPRG00000000000000001',
  sentAt: T0.toISOString(),
  body: { eventId: eventIdOf(PURGE_EVENT) },
});

function createContainer(kind: (typeof INVOCATION_KINDS)[number]): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: { kind, correlationId: crypto.randomUUID(), clientIp: undefined },
    },
    MODULES,
  );
}

function noticeIdOf(recipient: number, index: number): string {
  return `01JC0NTC${String(recipient)}${String(index).padStart(17, '0')}`;
}

// 送った・送らなかった・未送信の通知を順に繰り返す
function noticeRowOf(recipient: number, index: number): NoticeRow {
  const status = (['sent', 'skipped', 'pending'] as const)[index % 3];
  return {
    id: noticeIdOf(recipient, index),
    dedupeKey: `account-purge:${String(recipient)}:${String(index)}`,
    slotKey: 'evening:2026-11-01',
    groupKey: `evening:2026-11-01:${recipientIdOf(recipient)}`,
    topic: 'match_result',
    recipientUserId: recipientIdOf(recipient),
    status,
    skipReason: status === 'skipped' ? 'recipient_withdrawn' : null,
    settledAt: status === 'pending' ? null : T0,
    createdAt: T0,
    updatedAt: T0,
  };
}

async function insertNotices(recipient: number, count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, index) =>
    noticeRowOf(recipient, index),
  );
  const inserts = [];
  for (let start = 0; start < rows.length; start += NOTICE_ROWS_PER_INSERT) {
    inserts.push(
      db
        .insert(notificationNotices)
        .values(rows.slice(start, start + NOTICE_ROWS_PER_INSERT)),
    );
  }
  for (
    let start = 0;
    start < inserts.length;
    start += NOTICE_INSERTS_PER_BATCH
  ) {
    const [first, ...rest] = inserts.slice(
      start,
      start + NOTICE_INSERTS_PER_BATCH,
    );
    if (first !== undefined) {
      await db.batch([first, ...rest]);
    }
  }
}

// 本番と同じ通知のストアとトークンの発行で、利用者の受信設定とトークンの種を作る
async function seedPreferencesAndTokens(recipient: number): Promise<void> {
  const container = createContainer('queue');
  const userId = recipientIdOf(recipient);
  await container
    .get<NotificationPreferenceStore>(
      NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore,
    )
    .setPreference({ userId, topic: 'match_result', enabled: true, at: T0 });
  await container
    .get<UnsubscribeTokenService>(
      NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService,
    )
    .tokensFor(
      [
        { userId, topic: 'match_result' },
        { userId, topic: 'match_preview' },
      ],
      T0,
    );
}

async function seedRecipients(purgedNotices: number): Promise<void> {
  await insertRecipient(PURGED, { deletedAt: T0 });
  await insertRecipient(OTHER);
  await insertNotices(PURGED, purgedNotices);
  await insertNotices(OTHER, 3);
  await seedPreferencesAndTokens(PURGED);
  await seedPreferencesAndTokens(OTHER);
  await insertEvent(PURGE_EVENT, {
    userId: recipientIdOf(PURGED),
    type: 'purge_due',
  });
}

function isEnvelopeOf(type: string, sent: unknown): sent is QueueEnvelope {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === type
  );
}

// 本番と同じエントリのqueueハンドラーで処理する。続きの送り直しは実際には送らず、遅延の秒数だけを記録する
async function dispatch(envelope: QueueEnvelope): Promise<MessageOutcome> {
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
    const resend = sendSpy.mock.calls
      .filter(([sent]) => isEnvelopeOf(RUN_USER_LIFECYCLE_MESSAGE.type, sent))
      .at(-1);
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      ...(resend === undefined
        ? {}
        : { resentDelaySeconds: resend[1]?.delaySeconds }),
    };
  } finally {
    sendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

async function userRowExists(recipient: number): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, recipientIdOf(recipient)));
  return rows.length === 1;
}

async function noticeCountsByRecipient(): Promise<Record<string, number>> {
  const rows = await db
    .select({ recipientUserId: notificationNotices.recipientUserId })
    .from(notificationNotices);
  return Object.fromEntries(
    [...Map.groupBy(rows, ({ recipientUserId }) => recipientUserId)].map(
      ([recipientUserId, group]) => [recipientUserId, group.length],
    ),
  );
}

async function preferenceOwners(): Promise<readonly string[]> {
  const rows = await db
    .select({ userId: notificationPreferences.userId })
    .from(notificationPreferences)
    .orderBy(asc(notificationPreferences.userId));
  return rows.map(({ userId }) => userId);
}

async function tokenOwners(): Promise<readonly string[]> {
  return (await readUnsubscribeTokenRows()).map(({ userId }) => userId);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearNotificationTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('通知の物理削除の波及処理の登録', () => {
  test('利用者の物理削除の開始に帯の1300で登録し、登録の検証を通ってmatch-engineのUpvoteの物理削除の後に並ぶ', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('notifications.'),
      ),
    ).toStrictEqual([
      {
        name: HANDLER_NAME,
        events: ['purge_due'],
        order: 1300,
        handler: EVENT_NOTIFICATIONS_TYPES.AccountPurgeHandler,
      },
    ]);
    expect(
      createAsyncLifecycleRegistry(USER_LIFECYCLE_ASYNC_HANDLERS)
        .handlersFor('purge_due')
        .map(({ name }) => name),
    ).toStrictEqual([
      'inquiry-chat.member-inquiry-purge',
      'payments.customer-erasure',
      'ultras-subscription.subscription-erasure',
      'user-profile-social.profile-erasure',
      'user-profile-social.owned-file-erasure',
      'product-launch.product-erasure',
      'match-engine.upvote-erasure',
      HANDLER_NAME,
      'engagement.account-erasure',
      'sponsorship.account-purge',
    ]);
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、波及処理を実装のクラスに解決する',
    (kind) => {
      expect(
        createContainer(kind).get<UserLifecycleAsyncHandler>(
          EVENT_NOTIFICATIONS_TYPES.AccountPurgeHandler,
        ),
      ).toBeInstanceOf(AccountPurgeHandler);
    },
  );
});

describe('退会者の通知の物理削除(notifications.account-purge)', () => {
  test('通知・受信設定・トークンの種を持つ退会者の物理削除の開始の処理が外部キーで失敗せずに利用者を消し、他の利用者の行を残す', async () => {
    await seedRecipients(3);

    const outcome = await dispatch(userEnvelope);

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(userRowExists(PURGED)).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();
    await expect(noticeCountsByRecipient()).resolves.toStrictEqual({
      [recipientIdOf(OTHER)]: 3,
    });
    await expect(preferenceOwners()).resolves.toStrictEqual([
      recipientIdOf(OTHER),
    ]);
    await expect(tokenOwners()).resolves.toStrictEqual([
      recipientIdOf(OTHER),
      recipientIdOf(OTHER),
    ]);
    await expect(userRowExists(OTHER)).resolves.toBe(true);
  });

  test('1回の上限を超える通知を持つ退会者は、1,000件を消して続きの送り直しを返し、再開の処理で残りを消して利用者を消す', async () => {
    await seedRecipients(NOTICES_OVER_BATCH);

    const first = await dispatch(userEnvelope);

    expect(first).toStrictEqual({
      acked: true,
      retried: false,
      resentDelaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    await expect(noticeCountsByRecipient()).resolves.toStrictEqual({
      [recipientIdOf(PURGED)]: NOTICES_OVER_BATCH - 1000,
      [recipientIdOf(OTHER)]: 3,
    });
    await expect(userRowExists(PURGED)).resolves.toBe(true);
    await expect(preferenceOwners()).resolves.toStrictEqual([
      recipientIdOf(PURGED),
      recipientIdOf(OTHER),
    ]);

    const last = await dispatch(userEnvelope);

    expect(last).toStrictEqual({ acked: true, retried: false });
    await expect(userRowExists(PURGED)).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();
    await expect(noticeCountsByRecipient()).resolves.toStrictEqual({
      [recipientIdOf(OTHER)]: 3,
    });
    await expect(preferenceOwners()).resolves.toStrictEqual([
      recipientIdOf(OTHER),
    ]);
    await expect(tokenOwners()).resolves.toStrictEqual([
      recipientIdOf(OTHER),
      recipientIdOf(OTHER),
    ]);
  });
});
