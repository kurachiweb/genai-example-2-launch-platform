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
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { dataExports } from '../../db/schema/data-export/data-exports.ts';
import { users } from '../../db/schema/identity/users.ts';
import {
  USER_LIFECYCLE_RETRY_POLICY,
  type UserLifecycleAsyncHandler,
  type UserLifecycleEvent,
  type UserLifecycleEventType,
} from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  type ExportRow,
  failedColumnsOf,
  db as exportDb,
  queuedRowOf,
  readExportIds,
  readyColumnsOf,
  seed,
  daysAfter,
  expiredColumnsOf,
} from '../../lib/workers/data-export/testing/data-export-fixtures.ts';
import {
  clearIdentityTables,
  eventIdOf,
  insertEvent,
  insertUsers,
  readEvent,
  readHandlerRuns,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  installRecordingSentry,
  resetObservability,
} from '../../lib/workers/tournament/testing/observability-fixtures.ts';
import { EVENT_DATA_EXPORT_TYPES } from '../application/data-export/event-data-export-types.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';
import { MODULES } from './modules.ts';

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

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const OWNER = 1;

const OTHER = 2;

const EVENT = 10;

const ERASURE_HANDLER_NAME = 'data-export.archive-erasure';

const EVENT_TYPES = ['withdrawn', 'purge_due'] as const;

const BATCH_SIZE = 100;

// エントリのqueueハンドラーはSentryの計装が記録用のクライアントを置き換えるため、計装の内側の振り分けを直接呼ぶ
const dispatcher = createQueueDispatcher(MESSAGE_HANDLERS, MODULES);

let envelopeCount = 0;

function keyOf(index: number): string {
  return `data-exports/erasure-test-${String(index)}.zip`;
}

function exportRow(
  index: number,
  userIndex: number,
  columns: Partial<ExportRow> = {},
): ExportRow {
  return queuedRowOf(index, userIndex, {
    userId: userIdOf(userIndex),
    ...columns,
  });
}

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

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return {
    id: eventIdOf(EVENT),
    userId: userIdOf(OWNER),
    type,
    occurredAt: T0,
  };
}

function handlerOf(): UserLifecycleAsyncHandler {
  return createContainer().get<UserLifecycleAsyncHandler>(
    EVENT_DATA_EXPORT_TYPES.ArchiveErasureHandler,
  );
}

async function putObject(key: string): Promise<void> {
  await env.FILES_BUCKET.put(key, 'zip');
}

async function objectExists(key: string): Promise<boolean> {
  return (await env.FILES_BUCKET.head(key)) !== null;
}

async function beginUpload(key: string): Promise<string> {
  const upload = await env.FILES_BUCKET.createMultipartUpload(key);
  await upload.uploadPart(1, new Uint8Array([1, 2, 3]));
  return upload.uploadId;
}

async function uploadIsAlive(key: string, uploadId: string): Promise<boolean> {
  try {
    await env.FILES_BUCKET.resumeMultipartUpload(key, uploadId).uploadPart(
      2,
      new Uint8Array([4]),
    );
    return true;
  } catch {
    return false;
  }
}

async function readExportIdsOf(userIndex: number): Promise<string[]> {
  const rows = await exportDb
    .select({ id: dataExports.id })
    .from(dataExports)
    .where(eq(dataExports.userId, userIdOf(userIndex)));
  return rows.map(({ id }) => id).toSorted();
}

function lifecycleEnvelope(): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type: RUN_USER_LIFECYCLE_MESSAGE.type,
    id: `01JE0DXERS${String(envelopeCount).padStart(16, '0')}`,
    sentAt: T0.toISOString(),
    body: { eventId: eventIdOf(EVENT) },
  };
}

interface DispatchOptions {
  readonly runtimeEnv?: Env;
  readonly attempts?: number;
}

interface DispatchOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly deadLetters: readonly unknown[];
}

async function dispatch(
  envelope: QueueEnvelope,
  options: DispatchOptions = {},
): Promise<DispatchOutcome> {
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
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  const ctx = createExecutionContext();
  await dispatcher.dispatch(batch, options.runtimeEnv ?? env, ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  return {
    acked: explicitAcks.includes(message.id),
    retried: retryMessages.some(({ msgId }) => msgId === message.id),
    deadLetters: deadLetterSpy.mock.calls.map(([notice]) => notice),
  };
}

function envWithFailingDelete(failure: Error): Env {
  const bucket = new Proxy(env.FILES_BUCKET, {
    get(target, property) {
      if (property === 'delete') {
        return () => Promise.reject(failure);
      }
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== 'function') {
        return value;
      }
      return (...args: unknown[]): unknown =>
        Reflect.apply(value, target, args);
    },
  });
  return { ...env, FILES_BUCKET: bucket };
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await exportDb.delete(dataExports);
  await clearIdentityTables();
  await insertUsers([OWNER, OTHER], { deletedAt: daysAfter(0, T0) });
});

afterEach(() => {
  resetObservability();
  vi.restoreAllMocks();
});

describe.each(EVENT_TYPES)('ArchiveErasureHandler(%s)', (type) => {
  test('期限切れ・失敗・作成中を含む利用者の全ての記録と、完了のオブジェクトと途中のアップロードを消し、他の利用者の記録は残す', async () => {
    const failedUploadId = await beginUpload(keyOf(3));
    const queuedUploadId = await beginUpload(keyOf(4));
    const otherUploadId = await beginUpload(keyOf(9));
    await putObject(keyOf(1));
    await putObject(keyOf(8));
    await seed([
      exportRow(1, OWNER, {
        ...readyColumnsOf(daysAfter(7)),
        objectKey: keyOf(1),
      }),
      exportRow(2, OWNER, expiredColumnsOf()),
      exportRow(3, OWNER, {
        ...failedColumnsOf(),
        objectKey: keyOf(3),
        uploadId: failedUploadId,
      }),
      exportRow(4, OWNER, { objectKey: keyOf(4), uploadId: queuedUploadId }),
      exportRow(8, OTHER, {
        ...readyColumnsOf(daysAfter(7)),
        objectKey: keyOf(8),
      }),
      exportRow(9, OTHER, {
        ...failedColumnsOf(),
        objectKey: keyOf(9),
        uploadId: otherUploadId,
      }),
    ]);

    await expect(handlerOf().handle(eventOf(type))).resolves.toStrictEqual({
      kind: 'done',
    });

    await expect(readExportIdsOf(OWNER)).resolves.toStrictEqual([]);
    await expect(readExportIdsOf(OTHER)).resolves.toHaveLength(2);
    await expect(objectExists(keyOf(1))).resolves.toBe(false);
    await expect(uploadIsAlive(keyOf(3), failedUploadId)).resolves.toBe(false);
    await expect(uploadIsAlive(keyOf(4), queuedUploadId)).resolves.toBe(false);
    await expect(objectExists(keyOf(8))).resolves.toBe(true);
    await expect(uploadIsAlive(keyOf(9), otherUploadId)).resolves.toBe(true);
  });

  test('2回目の呼び出しは結果を変えずdoneを返す', async () => {
    await putObject(keyOf(9));
    await seed([
      exportRow(1, OWNER, {
        ...readyColumnsOf(daysAfter(7)),
        objectKey: keyOf(1),
      }),
      exportRow(9, OTHER, {
        ...readyColumnsOf(daysAfter(7)),
        objectKey: keyOf(9),
      }),
    ]);
    const handler = handlerOf();
    await handler.handle(eventOf(type));

    await expect(handler.handle(eventOf(type))).resolves.toStrictEqual({
      kind: 'done',
    });

    await expect(readExportIds()).resolves.toStrictEqual([
      exportRow(9, OTHER).id,
    ]);
    await expect(objectExists(keyOf(9))).resolves.toBe(true);
  });

  test('100件を消した回は続きを返し、次の呼び出しで残りを消してdoneを返す', async () => {
    await seed(
      Array.from({ length: BATCH_SIZE + 1 }, (_, index) =>
        exportRow(index + 1, OWNER, expiredColumnsOf()),
      ),
    );
    const handler = handlerOf();

    await expect(handler.handle(eventOf(type))).resolves.toStrictEqual({
      kind: 'continue',
    });
    await expect(readExportIdsOf(OWNER)).resolves.toHaveLength(1);

    await expect(handler.handle(eventOf(type))).resolves.toStrictEqual({
      kind: 'done',
    });
    await expect(readExportIdsOf(OWNER)).resolves.toStrictEqual([]);
  });

  test('記録が無い利用者にはdoneを返す', async () => {
    await expect(handlerOf().handle(eventOf(type))).resolves.toStrictEqual({
      kind: 'done',
    });
  });
});

describe('ユーザーライフサイクルの実行器からの呼び出し', () => {
  test('退会のメッセージで記録とオブジェクトを消し、波及処理とイベントを完了する', async () => {
    await putObject(keyOf(1));
    await seed([
      exportRow(1, OWNER, {
        ...readyColumnsOf(daysAfter(7)),
        objectKey: keyOf(1),
      }),
    ]);
    await insertEvent(EVENT, { userId: userIdOf(OWNER), type: 'withdrawn' });

    await expect(dispatch(lifecycleEnvelope())).resolves.toStrictEqual({
      acked: true,
      retried: false,
      deadLetters: [],
    });

    await expect(readExportIdsOf(OWNER)).resolves.toStrictEqual([]);
    await expect(objectExists(keyOf(1))).resolves.toBe(false);
    await expect(readHandlerRuns()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ handlerName: ERASURE_HANDLER_NAME }),
      ]),
    );
    await expect(readEvent(EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('物理削除の開始のメッセージで記録を消し、外部キーの違反なく利用者の行まで物理削除する', async () => {
    await seed([exportRow(1, OWNER, expiredColumnsOf())]);
    await insertEvent(EVENT, { userId: userIdOf(OWNER), type: 'purge_due' });

    await expect(dispatch(lifecycleEnvelope())).resolves.toStrictEqual({
      acked: true,
      retried: false,
      deadLetters: [],
    });

    await expect(readExportIdsOf(OWNER)).resolves.toStrictEqual([]);
    const owners = await exportDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userIdOf(OWNER)));
    expect(owners).toStrictEqual([]);
    await expect(readEvent(EVENT)).resolves.toBeUndefined();
  });

  test('オブジェクトの削除の失敗は記録を残して再試行に回し、次の配信で消し直す', async () => {
    await putObject(keyOf(1));
    await seed([
      exportRow(1, OWNER, {
        ...readyColumnsOf(daysAfter(7)),
        objectKey: keyOf(1),
      }),
    ]);
    await insertEvent(EVENT, { userId: userIdOf(OWNER), type: 'withdrawn' });
    const envelope = lifecycleEnvelope();

    await expect(
      dispatch(envelope, {
        runtimeEnv: envWithFailingDelete(new Error('R2の障害')),
      }),
    ).resolves.toStrictEqual({ acked: false, retried: true, deadLetters: [] });

    await expect(readExportIdsOf(OWNER)).resolves.toHaveLength(1);
    await expect(objectExists(keyOf(1))).resolves.toBe(true);
    await expect(readHandlerRuns()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ handlerName: ERASURE_HANDLER_NAME }),
      ]),
    );
    await expect(readEvent(EVENT)).resolves.toMatchObject({
      status: 'pending',
    });

    await expect(dispatch(envelope, { attempts: 2 })).resolves.toStrictEqual({
      acked: true,
      retried: false,
      deadLetters: [],
    });

    await expect(readExportIdsOf(OWNER)).resolves.toStrictEqual([]);
    await expect(objectExists(keyOf(1))).resolves.toBe(false);
    await expect(readEvent(EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('再試行を使い切った削除の失敗は、デッドレターの通知を経てエラートラッキングへ送られ、イベントは未完了のまま残る', async () => {
    const events = installRecordingSentry();
    await seed([
      exportRow(1, OWNER, {
        ...readyColumnsOf(daysAfter(7)),
        objectKey: keyOf(1),
      }),
    ]);
    await insertEvent(EVENT, { userId: userIdOf(OWNER), type: 'withdrawn' });
    const envelope = lifecycleEnvelope();

    const exhausted = await dispatch(envelope, {
      runtimeEnv: envWithFailingDelete(new Error('R2の障害')),
      attempts: USER_LIFECYCLE_RETRY_POLICY.maxAttempts,
    });

    expect(exhausted).toMatchObject({ acked: true, retried: false });
    expect(exhausted.deadLetters).toStrictEqual([
      expect.objectContaining({
        kind: 'dead-letter-notice',
        type: RUN_USER_LIFECYCLE_MESSAGE.type,
        reason: 'handler-failed',
        errorName: 'Error',
        attempts: USER_LIFECYCLE_RETRY_POLICY.maxAttempts,
      }),
    ]);
    await expect(readExportIdsOf(OWNER)).resolves.toHaveLength(1);
    await expect(readEvent(EVENT)).resolves.toMatchObject({
      status: 'pending',
    });

    const [notice] = exhausted.deadLetters;
    const deadLetterBatch = createMessageBatch(env.JOBS_DLQ_NAME, [
      { id: envelope.id, timestamp: T0, attempts: 1, body: notice },
    ]);
    await dispatcher.dispatch(deadLetterBatch, env, createExecutionContext());

    await vi.waitFor(() => {
      expect(
        events.map(({ tags }) => ({
          reason: tags?.['dead_letter_reason'],
          type: tags?.['message_type'],
        })),
      ).toStrictEqual([
        { reason: 'handler-failed', type: RUN_USER_LIFECYCLE_MESSAGE.type },
      ]);
    });
  });
});
