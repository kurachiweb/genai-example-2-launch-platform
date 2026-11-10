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
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { users } from '../../db/schema/identity/users.ts';
import {
  createAsyncLifecycleRegistry,
  LIFECYCLE_CONTINUE_DELAY_SECONDS,
  type UserLifecycleAsyncHandler,
} from '../../lib/core/identity/user-lifecycle.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  db,
  eventIdOf,
  insertEvent,
  insertUser,
  insertUsers,
  readEvent,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { EVENT_PROFILE_TYPES } from '../application/profile/event-profile-types.ts';
import { OwnedFileErasureHandler } from '../application/profile/owned-file-erasure-handler.ts';
import { OwnedImageQuarantineHandler } from '../application/profile/owned-image-quarantine-handler.ts';
import type { ProfilePurgeStore } from '../application/profile/ports.ts';
import { ProfileErasureHandler } from '../application/profile/profile-erasure-handler.ts';
import worker from '../index.ts';
import { D1ProfilePurgeStore } from '../infrastructure/profile/d1-profile-purge-store.ts';
import {
  clearMediaTables,
  FILE_PURPOSE,
  insertFile,
  insertReason,
  readFile,
  readReasons,
} from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import {
  insertFollows,
  insertProfileRows,
  readFollowIdsOf,
  readProfileRowCounts,
  resetProfilePurgeRows,
} from '../infrastructure/profile/testing/profile-purge-fixtures.ts';
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

const PROFILE_ERASURE_NAME = 'user-profile-social.profile-erasure';

const OWNED_FILE_ERASURE_NAME = 'user-profile-social.owned-file-erasure';

const OWNED_IMAGE_QUARANTINE_NAME =
  'user-profile-social.owned-image-quarantine';

const SUSPENDED_EVENT = 20;

const UNSUSPENDED_EVENT = 21;

const PURGED = 1;

const PURGE_EVENT = 10;

const FOLLOWEES = 600;

const FOLLOWERS = 401;

const INVOCATION_KINDS = ['fetch', 'scheduled', 'queue'] as const;

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

function isLifecycleEnvelope(sent: unknown): boolean {
  return (
    typeof sent === 'object' &&
    sent !== null &&
    'type' in sent &&
    sent.type === RUN_USER_LIFECYCLE_MESSAGE.type
  );
}

// 続きのある波及処理はメッセージをackし、同じ封筒を遅延つきで送り直すため、送り直しの遅延秒数をsendの呼び出しの引数で確かめる。画像の移動の依頼も同じキューへ送られるので、ライフサイクルの封筒だけを送り直しとして数える
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
    const resend = resendSpy.mock.calls
      .filter(([sent]) => isLifecycleEnvelope(sent))
      .at(-1);
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

function range(start: number, count: number): readonly number[] {
  return Array.from({ length: count }, (_, offset) => start + offset);
}

// 物理削除の時期を迎えた退会者に、本人がフォロワーの600件と相手の401件のフォローとプロフィールの行を入れる
async function arrangeWithdrawnUserWithFollows(): Promise<void> {
  const followeeIndexes = range(PURGED + 1, FOLLOWEES);
  const followerIndexes = range(PURGED + 1 + FOLLOWEES, FOLLOWERS);
  await insertUser(PURGED, { deletedAt: T0 });
  await insertUsers([...followeeIndexes, ...followerIndexes]);
  await insertFollows([
    ...followeeIndexes.map((index) => ({
      index,
      followerIndex: PURGED,
      followeeIndex: index,
    })),
    ...followerIndexes.map((index) => ({
      index,
      followerIndex: index,
      followeeIndex: PURGED,
    })),
  ]);
  await insertProfileRows(PURGED);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await clearMediaTables();
  await resetProfilePurgeRows();
});

describe('プロフィールの物理削除の波及処理の登録', () => {
  test('物理削除の開始に、フォロー・プロフィールの行の削除を順序600、ファイルの削除を順序610で、停止・停止解除に画像の隔離を順序600で登録する', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('user-profile-social.'),
      ),
    ).toStrictEqual([
      {
        name: PROFILE_ERASURE_NAME,
        events: ['purge_due'],
        order: 600,
        handler: EVENT_PROFILE_TYPES.ProfileErasureHandler,
      },
      {
        name: OWNED_FILE_ERASURE_NAME,
        events: ['purge_due'],
        order: 610,
        handler: EVENT_PROFILE_TYPES.OwnedFileErasureHandler,
      },
      {
        name: OWNED_IMAGE_QUARANTINE_NAME,
        events: ['suspended', 'unsuspended'],
        order: 600,
        handler: EVENT_PROFILE_TYPES.OwnedImageQuarantineHandler,
      },
    ]);
  });

  test('登録の検証を通り、ultras-subscriptionの後・product-launchの波及処理の前に並ぶ', () => {
    const registry = createAsyncLifecycleRegistry(
      USER_LIFECYCLE_ASYNC_HANDLERS,
    );

    expect(
      registry.handlersFor('purge_due').map(({ name }) => name),
    ).toStrictEqual([
      'inquiry-chat.member-inquiry-purge',
      'payments.customer-erasure',
      'ultras-subscription.subscription-erasure',
      PROFILE_ERASURE_NAME,
      OWNED_FILE_ERASURE_NAME,
      'product-launch.product-erasure',
    ]);
    expect(
      registry.handlersFor('suspended').map(({ name }) => name),
    ).toStrictEqual([
      'payments.open-checkout-expiry',
      'ultras-subscription.subscription-cancellation',
      OWNED_IMAGE_QUARANTINE_NAME,
      'match-engine.account-decision-follow-up',
    ]);
    expect(
      registry.handlersFor('unsuspended').map(({ name }) => name),
    ).toStrictEqual([OWNED_IMAGE_QUARANTINE_NAME]);
  });

  test.each(INVOCATION_KINDS)(
    '%s経路の処理単位のコンテナから、ストアと3つの波及処理を実装のクラスに解決する',
    (kind) => {
      const container = createContainer(kind);

      expect(
        container.get<ProfilePurgeStore>(EVENT_PROFILE_TYPES.ProfilePurgeStore),
      ).toBeInstanceOf(D1ProfilePurgeStore);
      expect(
        container.get<UserLifecycleAsyncHandler>(
          EVENT_PROFILE_TYPES.ProfileErasureHandler,
        ),
      ).toBeInstanceOf(ProfileErasureHandler);
      expect(
        container.get<UserLifecycleAsyncHandler>(
          EVENT_PROFILE_TYPES.OwnedFileErasureHandler,
        ),
      ).toBeInstanceOf(OwnedFileErasureHandler);
      expect(
        container.get<UserLifecycleAsyncHandler>(
          EVENT_PROFILE_TYPES.OwnedImageQuarantineHandler,
        ),
      ).toBeInstanceOf(OwnedImageQuarantineHandler);
    },
  );
});

describe('退会者のプロフィールの物理削除', () => {
  test('1,001件のフォローは1回目のメッセージで続きを待ち、2回目で残りと自分の行を消して利用者の行まで物理削除する', async () => {
    await arrangeWithdrawnUserWithFollows();
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
    await expect(readFollowIdsOf(PURGED)).resolves.toHaveLength(1);
    await expect(readProfileRowCounts(PURGED)).resolves.toStrictEqual({
      profiles: 1,
      websites: 1,
      previousHandles: 1,
    });
    await expect(userRowExists(PURGED)).resolves.toBe(true);
    await expect(readEvent(PURGE_EVENT)).resolves.toMatchObject({
      status: 'pending',
    });

    const second = await dispatch(envelope);

    expect(second).toStrictEqual({ acked: true, retried: false });
    await expect(readFollowIdsOf(PURGED)).resolves.toStrictEqual([]);
    await expect(readProfileRowCounts(PURGED)).resolves.toStrictEqual({
      profiles: 0,
      websites: 0,
      previousHandles: 0,
    });
    await expect(userRowExists(PURGED)).resolves.toBe(false);
    await expect(readEvent(PURGE_EVENT)).resolves.toBeUndefined();
  });

  test('フォローが上限に満たない退会者は1回のメッセージで全てを消し、フォロー相手の利用者の行は残す', async () => {
    await insertUser(PURGED, { deletedAt: T0 });
    await insertProfileRows(PURGED);
    await insertEvent(PURGE_EVENT, {
      userId: userIdOf(PURGED),
      type: 'purge_due',
    });
    await insertUser(2);
    await insertFollows([
      { index: 1, followerIndex: 2, followeeIndex: PURGED },
    ]);

    const outcome = await dispatch(
      envelopeOf({ eventId: eventIdOf(PURGE_EVENT) }),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(userRowExists(PURGED)).resolves.toBe(false);
    await expect(readFollowIdsOf(2)).resolves.toStrictEqual([]);
    await expect(userRowExists(2)).resolves.toBe(true);
  });
});

async function reasonsByFile(): Promise<
  readonly (readonly [number, string])[]
> {
  const rows = await readReasons();
  return rows.map((row) => [Number(row.fileId.slice(-2)), row.reason]);
}

describe('停止・停止解除での利用者の画像の隔離', () => {
  test('停止のイベントで、利用者の画像にユーザー停止の隔離理由が付き、画像用でないファイルと他の利用者の画像には付かない', async () => {
    await insertUser(1, { status: 'suspended' });
    await insertUser(2);
    await insertFile(1);
    await insertFile(2, { location: 'quarantine' });
    await insertReason(2, 'auto');
    await insertFile(3, {
      purpose: FILE_PURPOSE,
      storage: 'files',
      location: 'files',
      contentType: 'application/pdf',
      width: null,
      height: null,
    });
    await insertFile(4, { ownerId: userIdOf(2) });
    await insertEvent(SUSPENDED_EVENT, {
      userId: userIdOf(1),
      type: 'suspended',
    });

    const outcome = await dispatch(
      envelopeOf({ eventId: eventIdOf(SUSPENDED_EVENT) }),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(reasonsByFile()).resolves.toStrictEqual([
      [1, 'user_suspended'],
      [2, 'auto'],
      [2, 'user_suspended'],
    ]);
    await expect(readEvent(SUSPENDED_EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('停止解除のイベントで、ユーザー停止の隔離理由だけが外れ、他の理由を持つ画像は隔離の理由が残る', async () => {
    await insertUser(1);
    await insertFile(1, { location: 'quarantine' });
    await insertReason(1, 'user_suspended');
    await insertFile(2, { location: 'quarantine' });
    await insertReason(2, 'user_suspended');
    await insertReason(2, 'admin_action');
    await insertFile(3, { location: 'quarantine' });
    await insertReason(3, 'auto');
    await insertEvent(UNSUSPENDED_EVENT, {
      userId: userIdOf(1),
      type: 'unsuspended',
    });

    const outcome = await dispatch(
      envelopeOf({ eventId: eventIdOf(UNSUSPENDED_EVENT) }),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(reasonsByFile()).resolves.toStrictEqual([
      [2, 'admin_action'],
      [3, 'auto'],
    ]);
    await expect(readFile(2)).resolves.toBeDefined();
    await expect(readEvent(UNSUSPENDED_EVENT)).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('同じ停止のイベントを2回処理しても隔離理由は重複せず、停止解除で元に戻る', async () => {
    await insertUser(1);
    await insertFile(1);
    await insertEvent(SUSPENDED_EVENT, {
      userId: userIdOf(1),
      type: 'suspended',
    });
    await dispatch(envelopeOf({ eventId: eventIdOf(SUSPENDED_EVENT) }));
    await dispatch(envelopeOf({ eventId: eventIdOf(SUSPENDED_EVENT) }));
    await expect(reasonsByFile()).resolves.toStrictEqual([
      [1, 'user_suspended'],
    ]);
    await insertEvent(UNSUSPENDED_EVENT, {
      userId: userIdOf(1),
      type: 'unsuspended',
    });

    await dispatch(envelopeOf({ eventId: eventIdOf(UNSUSPENDED_EVENT) }));

    await expect(reasonsByFile()).resolves.toStrictEqual([]);
  });
});
