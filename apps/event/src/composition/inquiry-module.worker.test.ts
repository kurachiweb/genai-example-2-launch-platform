import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
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
import {
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  type UserLifecycleAsyncHandler,
  type UserLifecycleEvent,
} from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearIdentityTables,
  db,
  eventIdOf,
  insertEvent,
  insertUser,
  readEvent,
  readHandlerRuns,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { EVENT_IDENTITY_TYPES } from '../application/identity/event-identity-types.ts';
import type { IdentityPurgeStore } from '../application/identity/ports.ts';
import { EVENT_INQUIRY_TYPES } from '../application/inquiry/event-inquiry-types.ts';
import { MemberInquiryPurgeHandler } from '../application/inquiry/member-inquiry-purge-handler.ts';
import type { MemberInquiryPurgeStore } from '../application/inquiry/ports.ts';
import worker from '../index.ts';
import { D1MemberInquiryPurgeStore } from '../infrastructure/inquiry/d1-member-inquiry-purge-store.ts';
import {
  fileIdOf,
  indexesFrom,
  insertMemberInquiries,
  insertMessageWithAttachments,
  memberInquiryIdOf,
  messageIdOf,
  readMemberInquiryRowsOf,
  resetMemberInquiryRows,
} from '../infrastructure/inquiry/testing/member-inquiry-purge-fixtures.ts';
import { EVENT_INQUIRY_MODULE } from './inquiry-module.ts';
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

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const PURGE_HANDLER_NAME = 'inquiry-chat.member-inquiry-purge';

const PURGED = 1;

const KEPT = 2;

const PURGE_EVENT = 10;

const NO_ROWS = { inquiryIds: [], messageIds: [], fileIds: [] };

const KEPT_USER_ROWS = {
  inquiryIds: [memberInquiryIdOf(1001)],
  messageIds: [messageIdOf(1001)],
  fileIds: [fileIdOf(1001)],
};

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'queue',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

let envelopeCount = 0;

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function envelopeOf(body: unknown): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type: RUN_USER_LIFECYCLE_MESSAGE.type,
    id: `01JC0MSG${String(envelopeCount).padStart(18, '0')}`,
    sentAt: T0.toISOString(),
    body,
  };
}

// 続きのある波及処理はメッセージをackし、同じ封筒を遅延つきで送り直すため、送り直しの遅延秒数をsendの呼び出しの引数で確かめる
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
  // 送り直したメッセージが後のテストの途中で届かないよう、実際には送らない
  const resendSpy = vi.spyOn(env.JOBS_QUEUE, 'send').mockResolvedValue({
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  });
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  const ctx = createExecutionContext();
  try {
    await queue(batch, env, ctx);
    const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
    // 封筒や本文の不正でデッドレターへ移ったメッセージもackされるため、処理まで届いたことを確かめる
    expect(deadLetterSpy).not.toHaveBeenCalled();
    const resend = resendSpy.mock.calls.at(-1);
    return {
      acked: explicitAcks.includes(message.id),
      retried: retryMessages.some(({ msgId }) => msgId === message.id),
      ...(resend === undefined
        ? {}
        : { resentDelaySeconds: resend[1]?.delaySeconds }),
    };
  } finally {
    resendSpy.mockRestore();
    deadLetterSpy.mockRestore();
  }
}

async function userRowExists(userIndex: number): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userIdOf(userIndex)));
  return rows.length === 1;
}

// 物理削除の時期を迎えた退会者に101件の問い合わせを、行が残るべき別の利用者に1件の問い合わせを入れる
async function arrangeWithdrawnUserWithInquiries(): Promise<void> {
  await insertUser(PURGED, { deletedAt: T0 });
  await insertUser(KEPT);
  await insertMemberInquiries(PURGED, indexesFrom(1, 101));
  await insertMemberInquiries(KEPT, [1001], null);
  await insertMessageWithAttachments(1, 1, [1, 2]);
  await insertMessageWithAttachments(2, 101, [3]);
  await insertMessageWithAttachments(1001, 1001, [1001]);
}

function purgeEventOf(userIndex: number): UserLifecycleEvent {
  return {
    id: eventIdOf(PURGE_EVENT),
    userId: userIdOf(userIndex),
    type: 'purge_due',
    occurredAt: T0,
  };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await resetMemberInquiryRows();
  await clearIdentityTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('イベントサーバーのinquiryの束縛と登録', () => {
  test('組み立ての一覧に本specのモジュールが含まれ、処理単位のコンテナから物理削除の波及処理とストアを解決する', () => {
    expect(MODULES).toContain(EVENT_INQUIRY_MODULE);
    const container = createContainer();

    expect(
      container.get<UserLifecycleAsyncHandler>(
        EVENT_INQUIRY_TYPES.MemberInquiryPurgeHandler,
      ),
    ).toBeInstanceOf(MemberInquiryPurgeHandler);
    expect(
      container.get<MemberInquiryPurgeStore>(
        EVENT_INQUIRY_TYPES.MemberInquiryPurgeStore,
      ),
    ).toBeInstanceOf(D1MemberInquiryPurgeStore);
  });

  test('物理削除の開始のイベントに順序300で登録する', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(
        (registration) => registration.name === PURGE_HANDLER_NAME,
      ),
    ).toStrictEqual([
      {
        name: PURGE_HANDLER_NAME,
        events: ['purge_due'],
        order: 300,
        handler: EVENT_INQUIRY_TYPES.MemberInquiryPurgeHandler,
      },
    ]);
  });
});

describe('退会者の問い合わせの物理削除', () => {
  test('101件の問い合わせは1回目のメッセージで100件を消して続きを待ち、2回目で残りを消して利用者の行まで物理削除する', async () => {
    await arrangeWithdrawnUserWithInquiries();
    await insertEvent(PURGE_EVENT, {
      userId: userIdOf(PURGED),
      type: 'purge_due',
    });
    const envelope = envelopeOf({ eventId: eventIdOf(PURGE_EVENT) });

    const first = await dispatch(envelope);

    expect(first).toStrictEqual({
      acked: true,
      retried: false,
      resentDelaySeconds: LIFECYCLE_CONTINUE_DELAY_SECONDS,
    });
    await expect(readMemberInquiryRowsOf(PURGED)).resolves.toStrictEqual({
      inquiryIds: [memberInquiryIdOf(101)],
      messageIds: [messageIdOf(2)],
      fileIds: [fileIdOf(3)],
    });
    await expect(readHandlerRuns()).resolves.toEqual([]);
    await expect(readEvent(PURGE_EVENT)).resolves.toMatchObject({
      status: 'pending',
    });
    await expect(userRowExists(PURGED)).resolves.toBe(true);

    const second = await dispatch(envelope);

    expect(second).toStrictEqual({ acked: true, retried: false });
    await expect(readMemberInquiryRowsOf(PURGED)).resolves.toStrictEqual(
      NO_ROWS,
    );
    await expect(userRowExists(PURGED)).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();

    const redelivered = await dispatch(envelope);

    expect(redelivered).toStrictEqual({ acked: true, retried: false });
    await expect(readMemberInquiryRowsOf(KEPT)).resolves.toStrictEqual(
      KEPT_USER_ROWS,
    );
    await expect(userRowExists(KEPT)).resolves.toBe(true);
  });

  test('問い合わせが残る間は利用者の行の物理削除が外部キーの違反で失敗し、波及処理が完了した後は成功する', async () => {
    await arrangeWithdrawnUserWithInquiries();
    const container = createContainer();
    const identityPurge = container.get<IdentityPurgeStore>(
      EVENT_IDENTITY_TYPES.IdentityPurgeStore,
    );
    const handler = container.get<UserLifecycleAsyncHandler>(
      EVENT_INQUIRY_TYPES.MemberInquiryPurgeHandler,
    );

    await expect(identityPurge.purge(userIdOf(PURGED))).rejects.toThrow();
    await expect(userRowExists(PURGED)).resolves.toBe(true);

    await expect(handler.handle(purgeEventOf(PURGED))).resolves.toStrictEqual({
      kind: 'continue',
    });
    await expect(handler.handle(purgeEventOf(PURGED))).resolves.toStrictEqual({
      kind: 'done',
    });
    await expect(handler.handle(purgeEventOf(PURGED))).resolves.toStrictEqual({
      kind: 'done',
    });

    await expect(
      identityPurge.purge(userIdOf(PURGED)),
    ).resolves.toBeUndefined();
    await expect(userRowExists(PURGED)).resolves.toBe(false);
    await expect(readMemberInquiryRowsOf(KEPT)).resolves.toStrictEqual(
      KEPT_USER_ROWS,
    );
  });

  test('利用者の行が既に無ければ、何も消さずに完了を返す', async () => {
    await insertUser(KEPT);
    await insertMemberInquiries(KEPT, [1001], null);
    await insertMessageWithAttachments(1001, 1001, [1001]);
    const handler = createContainer().get<UserLifecycleAsyncHandler>(
      EVENT_INQUIRY_TYPES.MemberInquiryPurgeHandler,
    );

    await expect(handler.handle(purgeEventOf(PURGED))).resolves.toStrictEqual({
      kind: 'done',
    });
    await expect(readMemberInquiryRowsOf(KEPT)).resolves.toStrictEqual(
      KEPT_USER_ROWS,
    );
  });
});
