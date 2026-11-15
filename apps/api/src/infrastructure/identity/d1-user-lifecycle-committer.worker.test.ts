import { eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase, type Database } from '../../../db/client.ts';
import { userAuthTokens } from '../../../db/schema/identity/user-auth-tokens.ts';
import { userLifecycleEvents } from '../../../db/schema/identity/user-lifecycle-events.ts';
import { userLifecycleHandlerRuns } from '../../../db/schema/identity/user-lifecycle-handler-runs.ts';
import { userLoginChallenges } from '../../../db/schema/identity/user-login-challenges.ts';
import { userSessions } from '../../../db/schema/identity/user-sessions.ts';
import { userTotpCredentials } from '../../../db/schema/identity/user-totp-credentials.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  LifecycleRegistrationError,
  type UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import {
  after,
  clearIdentityTables,
  createSequentialIds,
  db,
  eventIdOf,
  insertTotpCredential,
  insertUser,
  readEventsOf,
  readHandlerRuns,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  createFailingD1,
  FAILING_D1_MESSAGE,
} from '../../../test/support/failing-d1.ts';
import type {
  UserLifecycleCommitter,
  UserStateTransition,
} from '../../application/identity/ports.ts';
import { createD1UserLifecycleCommitter } from './d1-user-lifecycle-committer.ts';
import type {
  UserLifecycleSyncHandler,
  UserLifecycleSyncRegistration,
} from './user-lifecycle-sync-handler.ts';

const AT = after(60_000);

const FIRST_EVENT_INDEX = 1000;

const TARGET = 1;

const OTHER = 2;

interface HandlerCall {
  readonly name: string;
  readonly event: UserLifecycleEvent;
  readonly db: Database;
}

// 呼び出しを記録し、イベントの記録への外部キーを持つ完了の記録を1行加える文を返す偽の同期の波及処理
function recordingHandler(
  name: string,
  calls: HandlerCall[],
  runId: (event: UserLifecycleEvent) => string,
): UserLifecycleSyncHandler {
  return {
    statementsFor: (event, database) => {
      calls.push({ name, event, db: database });
      const statements: BatchItem<'sqlite'>[] = [
        database.insert(userLifecycleHandlerRuns).values({
          id: runId(event),
          eventId: event.id,
          handlerName: name,
          completedAt: event.occurredAt,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt,
        }),
      ];
      return Promise.resolve(statements);
    },
  };
}

function resolverOf(
  handlers: ReadonlyMap<symbol, UserLifecycleSyncHandler>,
): <T>(identifier: ServiceIdentifier<T>) => T {
  return <T>(identifier: ServiceIdentifier<T>): T => {
    const handler = handlers.get(identifier as symbol);
    if (handler === undefined) {
      throw new Error(`未登録の識別子: ${String(identifier)}`);
    }
    return handler as T;
  };
}

function createCommitter(
  registrations: readonly UserLifecycleSyncRegistration[] = [],
  handlers: ReadonlyMap<symbol, UserLifecycleSyncHandler> = new Map(),
  database: Database = db,
): UserLifecycleCommitter {
  return createD1UserLifecycleCommitter(
    database,
    createSequentialIds(FIRST_EVENT_INDEX),
    registrations,
    resolverOf(handlers),
  );
}

function transitionOf(
  kind: UserStateTransition['kind'],
  expectedVersion: number,
  userIndex = TARGET,
): UserStateTransition {
  return { kind, userId: userIdOf(userIndex), expectedVersion, at: AT };
}

async function readUser(index: number) {
  const [row] = await db
    .select({
      status: users.status,
      suspendedAt: users.suspendedAt,
      deletedAt: users.deletedAt,
      lifecycleVersion: users.lifecycleVersion,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userIdOf(index)));
  return row;
}

function sessionIdOf(userIndex: number, index: number): string {
  return `01JC0SESS${String(userIndex * 10 + index).padStart(17, '0')}`;
}

function hashOf(kind: string, userIndex: number, index: number): string {
  return [kind, 'hash', String(userIndex), String(index)].join('-');
}

async function insertCredentials(userIndex: number): Promise<void> {
  const userId = userIdOf(userIndex);
  for (const index of [1, 2]) {
    await db.insert(userSessions).values({
      id: sessionIdOf(userIndex, index),
      userId,
      tokenHash: hashOf('session', userIndex, index),
      userAgent: null,
      lastUsedAt: T0,
      absoluteExpiresAt: after(86_400_000),
      createdAt: T0,
      updatedAt: T0,
    });
  }
  await db.insert(userAuthTokens).values({
    userId,
    purpose: 'email_verification',
    tokenHash: hashOf('token', userIndex, 1),
    expiresAt: after(86_400_000),
    createdAt: T0,
    updatedAt: T0,
  });
  await db.insert(userLoginChallenges).values({
    userId,
    tokenHash: hashOf('challenge', userIndex, 1),
    expiresAt: after(600_000),
    createdAt: T0,
    updatedAt: T0,
  });
}

async function countCredentials(userIndex: number) {
  const userId = userIdOf(userIndex);
  const [sessions, tokens, challenges] = await Promise.all([
    db.select().from(userSessions).where(eq(userSessions.userId, userId)),
    db.select().from(userAuthTokens).where(eq(userAuthTokens.userId, userId)),
    db
      .select()
      .from(userLoginChallenges)
      .where(eq(userLoginChallenges.userId, userId)),
  ]);
  return {
    sessions: sessions.length,
    tokens: tokens.length,
    challenges: challenges.length,
  };
}

function causeMessagesOf(error: unknown): string[] {
  const messages: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    messages.push(current.message);
  }
  return messages;
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('失敗を期待しましたが成功しました');
}

function expectStateConflict(error: unknown): void {
  expect(error).toBeInstanceOf(AppError);
  expect(error).toMatchObject({
    kind: 'conflict',
    code: 'account_state_conflict',
  });
}

const EXPECTED_EVENT_ID = eventIdOf(FIRST_EVENT_INDEX);

beforeEach(async () => {
  await clearIdentityTables();
});

describe('createD1UserLifecycleCommitter', () => {
  describe('状態の遷移', () => {
    test('退会で論理削除して版を1増やし、退会のイベントを記録して返す', async () => {
      await insertUser(TARGET, { lifecycleVersion: 3 });

      const event = await createCommitter().commit(transitionOf('withdraw', 3));

      expect(event).toEqual({
        id: EXPECTED_EVENT_ID,
        userId: userIdOf(TARGET),
        type: 'withdrawn',
        occurredAt: AT,
      });
      await expect(readUser(TARGET)).resolves.toEqual({
        status: 'active',
        suspendedAt: null,
        deletedAt: AT,
        lifecycleVersion: 4,
        updatedAt: AT,
      });
      const events = await readEventsOf(TARGET);
      expect(events).toEqual([
        {
          id: EXPECTED_EVENT_ID,
          userId: userIdOf(TARGET),
          type: 'withdrawn',
          occurredAt: AT,
          status: 'pending',
          completedAt: null,
          dispatchCount: 1,
          lastDispatchedAt: AT,
          createdAt: AT,
          updatedAt: AT,
        },
      ]);
    });

    test('停止で状態と停止日時を入れて版を1増やし、停止のイベントを記録する', async () => {
      await insertUser(TARGET);

      const event = await createCommitter().commit(transitionOf('suspend', 0));

      expect(event).toMatchObject({ type: 'suspended', occurredAt: AT });
      await expect(readUser(TARGET)).resolves.toEqual({
        status: 'suspended',
        suspendedAt: AT,
        deletedAt: null,
        lifecycleVersion: 1,
        updatedAt: AT,
      });
      const events = await readEventsOf(TARGET);
      expect(events.map(({ type, status }) => ({ type, status }))).toEqual([
        { type: 'suspended', status: 'pending' },
      ]);
    });

    test('停止解除で状態を戻して停止日時を消し、停止解除のイベントを記録する', async () => {
      await insertUser(TARGET, {
        status: 'suspended',
        suspendedAt: T0,
        lifecycleVersion: 1,
      });

      const event = await createCommitter().commit(
        transitionOf('unsuspend', 1),
      );

      expect(event).toMatchObject({ type: 'unsuspended', occurredAt: AT });
      await expect(readUser(TARGET)).resolves.toEqual({
        status: 'active',
        suspendedAt: null,
        deletedAt: null,
        lifecycleVersion: 2,
        updatedAt: AT,
      });
      const events = await readEventsOf(TARGET);
      expect(events.map(({ type }) => type)).toEqual(['unsuspended']);
    });

    test('停止中の利用者の退会は停止の状態と停止日時を残したまま論理削除する', async () => {
      await insertUser(TARGET, {
        status: 'suspended',
        suspendedAt: T0,
        lifecycleVersion: 1,
      });

      await createCommitter().commit(transitionOf('withdraw', 1));

      await expect(readUser(TARGET)).resolves.toEqual({
        status: 'suspended',
        suspendedAt: T0,
        deletedAt: AT,
        lifecycleVersion: 2,
        updatedAt: AT,
      });
    });

    test('退会でその利用者のセッション・認証系トークン・第2要素の待ちだけを消し、TOTPは残す', async () => {
      await insertUser(TARGET);
      await insertUser(OTHER);
      await insertCredentials(TARGET);
      await insertCredentials(OTHER);
      await insertTotpCredential(TARGET, { enabledAt: T0 });

      await createCommitter().commit(transitionOf('withdraw', 0));

      await expect(countCredentials(TARGET)).resolves.toEqual({
        sessions: 0,
        tokens: 0,
        challenges: 0,
      });
      await expect(countCredentials(OTHER)).resolves.toEqual({
        sessions: 2,
        tokens: 1,
        challenges: 1,
      });
      const totp = await db
        .select({ userId: userTotpCredentials.userId })
        .from(userTotpCredentials);
      expect(totp).toEqual([{ userId: userIdOf(TARGET) }]);
    });

    test('停止と停止解除では既存のセッション・トークン・待ちを消さない', async () => {
      await insertUser(TARGET);
      await insertCredentials(TARGET);
      const committer = createCommitter();

      await committer.commit(transitionOf('suspend', 0));
      await committer.commit(transitionOf('unsuspend', 1));

      await expect(countCredentials(TARGET)).resolves.toEqual({
        sessions: 2,
        tokens: 1,
        challenges: 1,
      });
      const events = await readEventsOf(TARGET);
      expect(events.map(({ id, type }) => ({ id, type }))).toEqual([
        { id: eventIdOf(FIRST_EVENT_INDEX), type: 'suspended' },
        { id: eventIdOf(FIRST_EVENT_INDEX + 1), type: 'unsuspended' },
      ]);
    });
  });

  describe('同期の波及処理', () => {
    const WITHDRAWAL_HANDLER = Symbol.for('test.WithdrawalHandler');
    const SUSPENSION_HANDLER = Symbol.for('test.SuspensionHandler');
    const ANY_HANDLER = Symbol.for('test.AnyHandler');

    const REGISTRATIONS: readonly UserLifecycleSyncRegistration[] = [
      {
        name: 'test-spec.withdrawal',
        events: ['withdrawn'],
        handler: WITHDRAWAL_HANDLER,
      },
      {
        name: 'test-spec.suspension',
        events: ['suspended', 'unsuspended'],
        handler: SUSPENSION_HANDLER,
      },
      {
        name: 'test-spec.any',
        events: ['withdrawn', 'suspended', 'unsuspended'],
        handler: ANY_HANDLER,
      },
    ];

    function handlersOf(
      calls: HandlerCall[],
    ): ReadonlyMap<symbol, UserLifecycleSyncHandler> {
      return new Map([
        [
          WITHDRAWAL_HANDLER,
          recordingHandler('test-spec.withdrawal', calls, (event) =>
            event.id.replace('EVT', 'RNA'),
          ),
        ],
        [
          SUSPENSION_HANDLER,
          recordingHandler('test-spec.suspension', calls, (event) =>
            event.id.replace('EVT', 'RNB'),
          ),
        ],
        [
          ANY_HANDLER,
          recordingHandler('test-spec.any', calls, (event) =>
            event.id.replace('EVT', 'RNC'),
          ),
        ],
      ]);
    }

    test('種類に登録された波及処理だけを登録の順に呼び、返した文を同じ一括の書き込みで確定する', async () => {
      await insertUser(TARGET);
      const calls: HandlerCall[] = [];

      const event = await createCommitter(
        REGISTRATIONS,
        handlersOf(calls),
      ).commit(transitionOf('withdraw', 0));

      expect(calls.map(({ name }) => name)).toEqual([
        'test-spec.withdrawal',
        'test-spec.any',
      ]);
      for (const call of calls) {
        expect(call.event).toEqual(event);
        expect(call.db).toBe(db);
      }
      await expect(readHandlerRuns()).resolves.toEqual([
        {
          id: EXPECTED_EVENT_ID.replace('EVT', 'RNC'),
          eventId: EXPECTED_EVENT_ID,
          handlerName: 'test-spec.any',
          completedAt: AT,
        },
        {
          id: EXPECTED_EVENT_ID.replace('EVT', 'RNA'),
          eventId: EXPECTED_EVENT_ID,
          handlerName: 'test-spec.withdrawal',
          completedAt: AT,
        },
      ]);
    });

    test('停止では停止に登録された波及処理を呼ぶ', async () => {
      await insertUser(TARGET);
      const calls: HandlerCall[] = [];

      await createCommitter(REGISTRATIONS, handlersOf(calls)).commit(
        transitionOf('suspend', 0),
      );

      expect(calls.map(({ name }) => name)).toEqual([
        'test-spec.suspension',
        'test-spec.any',
      ]);
      const runs = await readHandlerRuns();
      expect(runs.map(({ handlerName }) => handlerName)).toEqual([
        'test-spec.any',
        'test-spec.suspension',
      ]);
    });

    test('読み取った版が古いと状態・波及処理の文・イベントのすべてを取り消して競合のエラーにする', async () => {
      await insertUser(TARGET, { lifecycleVersion: 2 });
      await insertCredentials(TARGET);
      const calls: HandlerCall[] = [];

      const error = await captureError(
        createCommitter(REGISTRATIONS, handlersOf(calls)).commit(
          transitionOf('withdraw', 1),
        ),
      );

      expectStateConflict(error);
      await expect(readUser(TARGET)).resolves.toEqual({
        status: 'active',
        suspendedAt: null,
        deletedAt: null,
        lifecycleVersion: 2,
        updatedAt: T0,
      });
      await expect(readEventsOf(TARGET)).resolves.toEqual([]);
      await expect(readHandlerRuns()).resolves.toEqual([]);
      await expect(countCredentials(TARGET)).resolves.toEqual({
        sessions: 2,
        tokens: 1,
        challenges: 1,
      });
    });

    test('同じ版を読んだ2つ目の遷移は競合のエラーになり、1つ目の結果だけが残る', async () => {
      await insertUser(TARGET);
      const committer = createCommitter();

      await committer.commit(transitionOf('suspend', 0));
      const error = await captureError(
        committer.commit(transitionOf('withdraw', 0)),
      );

      expectStateConflict(error);
      await expect(readUser(TARGET)).resolves.toMatchObject({
        status: 'suspended',
        deletedAt: null,
        lifecycleVersion: 1,
      });
      const events = await readEventsOf(TARGET);
      expect(events.map(({ type }) => type)).toEqual(['suspended']);
    });

    test('存在しない利用者の遷移は競合のエラーになり、イベントを記録しない', async () => {
      const error = await captureError(
        createCommitter().commit(transitionOf('suspend', 0)),
      );

      expectStateConflict(error);
      await expect(readEventsOf(TARGET)).resolves.toEqual([]);
    });

    test('波及処理の文が別の制約に違反したら、競合に変換せずにそのまま投げて全体を取り消す', async () => {
      await insertUser(TARGET);
      const calls: HandlerCall[] = [];
      const duplicateRunId = (event: UserLifecycleEvent) =>
        event.id.replace('EVT', 'DUP');
      const handlers = new Map([
        [
          WITHDRAWAL_HANDLER,
          recordingHandler('test-spec.withdrawal', calls, duplicateRunId),
        ],
        [ANY_HANDLER, recordingHandler('test-spec.any', calls, duplicateRunId)],
      ]);

      const error = await captureError(
        createCommitter(REGISTRATIONS, handlers).commit(
          transitionOf('withdraw', 0),
        ),
      );

      expect(error).not.toBeInstanceOf(AppError);
      await expect(readUser(TARGET)).resolves.toMatchObject({
        deletedAt: null,
        lifecycleVersion: 0,
      });
      await expect(readEventsOf(TARGET)).resolves.toEqual([]);
      await expect(readHandlerRuns()).resolves.toEqual([]);
    });

    test('波及処理が文の組み立てで失敗したら、何も書き込まずにそのまま投げる', async () => {
      await insertUser(TARGET);
      const failure = new Error('波及処理の読み取りの失敗');
      const handlers = new Map<symbol, UserLifecycleSyncHandler>([
        [WITHDRAWAL_HANDLER, { statementsFor: () => Promise.reject(failure) }],
        [
          ANY_HANDLER,
          recordingHandler('test-spec.any', [], (event) =>
            event.id.replace('EVT', 'RNC'),
          ),
        ],
      ]);

      const error = await captureError(
        createCommitter(REGISTRATIONS, handlers).commit(
          transitionOf('withdraw', 0),
        ),
      );

      expect(error).toBe(failure);
      await expect(readUser(TARGET)).resolves.toMatchObject({
        deletedAt: null,
        lifecycleVersion: 0,
      });
      await expect(readEventsOf(TARGET)).resolves.toEqual([]);
    });
  });

  describe('D1の障害', () => {
    test('一括の書き込みの障害は競合に変換せずにそのまま投げる', async () => {
      const error = await captureError(
        createCommitter(
          [],
          new Map(),
          createDatabase(createFailingD1()),
        ).commit(transitionOf('withdraw', 0)),
      );

      expect(error).not.toBeInstanceOf(AppError);
      expect(causeMessagesOf(error)).toContain(FAILING_D1_MESSAGE);
    });
  });

  describe('登録の検証', () => {
    const HANDLER = Symbol.for('test.Handler');

    test('名前が<spec名>.<名詞句>の形でない登録を作成時に拒否する', () => {
      expect(() =>
        createCommitter([
          { name: 'withdrawal', events: ['withdrawn'], handler: HANDLER },
        ]),
      ).toThrow(LifecycleRegistrationError);
    });

    test('名前が重複した登録を作成時に拒否する', () => {
      expect(() =>
        createCommitter([
          {
            name: 'test-spec.handler',
            events: ['withdrawn'],
            handler: HANDLER,
          },
          {
            name: 'test-spec.handler',
            events: ['suspended'],
            handler: HANDLER,
          },
        ]),
      ).toThrow(LifecycleRegistrationError);
    });
  });
});

describe('D1の版の検査の仕組み', () => {
  // 版が一致しなければ利用者IDをNULLにする挿入が、どのエラーで一括の書き込みを止めるかを実際のD1で確かめる
  test('版が一致しないイベントの挿入はNOT NULL制約の違反になり、同じ一括の書き込みの他の文も取り消される', async () => {
    await insertUser(TARGET, { lifecycleVersion: 1 });
    const userId = userIdOf(TARGET);

    const error = await captureError(
      db.batch([
        db.insert(userLifecycleEvents).values({
          id: EXPECTED_EVENT_ID,
          userId: sql`CASE WHEN (SELECT ${users.lifecycleVersion} FROM ${users} WHERE ${users.id} = ${userId}) = ${0} THEN ${userId} ELSE NULL END`,
          type: 'withdrawn',
          occurredAt: AT,
          lastDispatchedAt: AT,
          createdAt: AT,
          updatedAt: AT,
        }),
        db
          .update(users)
          .set({ lifecycleVersion: 2 })
          .where(eq(users.id, userId)),
      ]),
    );

    expect(causeMessagesOf(error)).toContainEqual(
      expect.stringContaining(
        'NOT NULL constraint failed: user_lifecycle_events.user_id',
      ),
    );
    await expect(readUser(TARGET)).resolves.toMatchObject({
      lifecycleVersion: 1,
    });
    await expect(readEventsOf(TARGET)).resolves.toEqual([]);
  });
});
