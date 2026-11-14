import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { count, eq, inArray, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest';

import { userAuthTokens } from '../../../db/schema/identity/user-auth-tokens.ts';
import { userLifecycleEvents } from '../../../db/schema/identity/user-lifecycle-events.ts';
import { userLifecycleHandlerRuns } from '../../../db/schema/identity/user-lifecycle-handler-runs.ts';
import { userLoginChallenges } from '../../../db/schema/identity/user-login-challenges.ts';
import { userRecoveryCodes } from '../../../db/schema/identity/user-recovery-codes.ts';
import { userSessions } from '../../../db/schema/identity/user-sessions.ts';
import { userTotpCredentials } from '../../../db/schema/identity/user-totp-credentials.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { createUserLifecycleStore } from '../../../lib/workers/identity/d1-user-lifecycle-store.ts';
import {
  after,
  clearIdentityTables,
  createSequentialIds,
  db,
  emailOf,
  eventIdOf,
  insertEvent,
  insertTotpCredential,
  insertUser,
  readEvent,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { IdentityPurgeStore } from '../../application/identity/ports.ts';
import { D1IdentityPurgeStore } from './d1-identity-purge-store.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

// 他specのテーブルが外部キーで利用者の行を参照している状態を再現する、このテストだけのテーブル
const REFERENCING_TABLE = 'purge_test_user_references';

const PURGED = 1;

const KEPT = 2;

function hashOf(kind: string, userIndex: number, serial = 1): string {
  return [kind, 'digest', String(userIndex), String(serial)].join('-');
}

// 利用者ごとに、物理削除の対象のテーブルすべてへ行を入れる
async function insertIdentityRows(
  userIndex: number,
  eventIndexes: readonly number[],
): Promise<void> {
  const userId = userIdOf(userIndex);
  await insertUser(userIndex, { deletedAt: T0 });
  await db.insert(userSessions).values({
    userId,
    tokenHash: hashOf('session', userIndex),
    lastUsedAt: T0,
    absoluteExpiresAt: after(60_000),
  });
  await db.insert(userAuthTokens).values({
    userId,
    purpose: 'password_reset',
    tokenHash: hashOf('mail-link', userIndex),
    expiresAt: after(60_000),
  });
  await db.insert(userLoginChallenges).values({
    userId,
    tokenHash: hashOf('challenge', userIndex),
    expiresAt: after(60_000),
  });
  await insertTotpCredential(userIndex, { enabledAt: T0 });
  await db.insert(userRecoveryCodes).values([
    { userId, codeHash: hashOf('recovery', userIndex, 1) },
    { userId, codeHash: hashOf('recovery', userIndex, 2) },
  ]);
  for (const [position, eventIndex] of eventIndexes.entries()) {
    await insertEvent(eventIndex, {
      userId,
      type: position === 0 ? 'withdrawn' : 'purge_due',
      status: position === 0 ? 'completed' : 'pending',
    });
    await db.insert(userLifecycleHandlerRuns).values({
      eventId: eventIdOf(eventIndex),
      handlerName: 'identity-auth.email-suppression-cleanup',
      completedAt: T0,
    });
  }
}

async function countWhere(table: SQLiteTable, condition: SQL) {
  const [row] = await db.select({ rows: count() }).from(table).where(condition);
  return row?.rows ?? 0;
}

async function countIdentityRowsOf(userIndex: number) {
  const userId = userIdOf(userIndex);
  return {
    users: await countWhere(users, eq(users.id, userId)),
    sessions: await countWhere(userSessions, eq(userSessions.userId, userId)),
    authTokens: await countWhere(
      userAuthTokens,
      eq(userAuthTokens.userId, userId),
    ),
    loginChallenges: await countWhere(
      userLoginChallenges,
      eq(userLoginChallenges.userId, userId),
    ),
    totpCredentials: await countWhere(
      userTotpCredentials,
      eq(userTotpCredentials.userId, userId),
    ),
    recoveryCodes: await countWhere(
      userRecoveryCodes,
      eq(userRecoveryCodes.userId, userId),
    ),
    lifecycleEvents: await countWhere(
      userLifecycleEvents,
      eq(userLifecycleEvents.userId, userId),
    ),
    handlerRuns: await countWhere(
      userLifecycleHandlerRuns,
      inArray(
        userLifecycleHandlerRuns.eventId,
        db
          .select({ id: userLifecycleEvents.id })
          .from(userLifecycleEvents)
          .where(eq(userLifecycleEvents.userId, userId)),
      ),
    ),
  };
}

const ALL_ROWS_OF_ONE_USER = {
  users: 1,
  sessions: 1,
  authTokens: 1,
  loginChallenges: 1,
  totpCredentials: 1,
  recoveryCodes: 2,
  lifecycleEvents: 2,
  handlerRuns: 2,
};

const NO_ROWS = {
  users: 0,
  sessions: 0,
  authTokens: 0,
  loginChallenges: 0,
  totpCredentials: 0,
  recoveryCodes: 0,
  lifecycleEvents: 0,
  handlerRuns: 0,
};

// Drizzle ORMはD1の例外をcauseに包むため、連鎖をたどって制約の違反の文言を探す
function causeMessagesOf(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join('\n');
}

function createPurgeStore(): IdentityPurgeStore {
  return new D1IdentityPurgeStore(db);
}

// setupFilesでcloudflare:testを読み込むと、他のテストファイルのvi.mockより先にエントリが読み込まれて差し替えが効かなくなるため、D1を使うこのファイルで適用する
beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS ${REFERENCING_TABLE} (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id))`,
  ).run();
});

afterAll(async () => {
  await env.DB.prepare(`DROP TABLE IF EXISTS ${REFERENCING_TABLE}`).run();
});

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM ${REFERENCING_TABLE}`).run();
  await clearIdentityTables();
});

describe('利用者の行の物理削除(D1)', () => {
  test('利用者のセッション・認証系トークン・ログインの待ち・TOTP・リカバリコード・イベントと完了の記録・利用者の行を削除し、他の利用者の行を残す', async () => {
    await insertIdentityRows(PURGED, [1, 2]);
    await insertIdentityRows(KEPT, [3, 4]);

    await createPurgeStore().purge(userIdOf(PURGED));

    expect(await countIdentityRowsOf(PURGED)).toEqual(NO_ROWS);
    expect(await countIdentityRowsOf(KEPT)).toEqual(ALL_ROWS_OF_ONE_USER);
  });

  test('削除の後は、同じハンドルとメールアドレスで別の利用者を登録できる', async () => {
    await insertIdentityRows(PURGED, [1, 2]);

    await createPurgeStore().purge(userIdOf(PURGED));
    await insertUser(KEPT, {
      handle: `user${String(PURGED)}`,
      email: emailOf(PURGED),
    });

    expect(await countWhere(users, eq(users.id, userIdOf(KEPT)))).toBe(1);
  });

  test('既に削除済みの利用者は何もせず成功する', async () => {
    await insertIdentityRows(KEPT, [3, 4]);

    await createPurgeStore().purge(userIdOf(PURGED));

    expect(await countIdentityRowsOf(KEPT)).toEqual(ALL_ROWS_OF_ONE_USER);
  });

  test('他のテーブルの行が外部キーで利用者を参照していれば失敗し、どの行も削除せずイベントを未完了に残す', async () => {
    await insertIdentityRows(PURGED, [1, 2]);
    await env.DB.prepare(
      `INSERT INTO ${REFERENCING_TABLE} (id, user_id) VALUES (?, ?)`,
    )
      .bind('reference-1', userIdOf(PURGED))
      .run();

    const caught = await createPurgeStore()
      .purge(userIdOf(PURGED))
      .catch((error: unknown) => error);

    expect(causeMessagesOf(caught)).toContain('FOREIGN KEY constraint failed');
    expect(await countIdentityRowsOf(PURGED)).toEqual(ALL_ROWS_OF_ONE_USER);
    expect((await readEvent(2))?.status).toBe('pending');
  });

  test('外部キーで失敗した物理削除のイベントは、ライフサイクルの記録から未完了のまま読める', async () => {
    await insertIdentityRows(PURGED, [1, 2]);
    await env.DB.prepare(
      `INSERT INTO ${REFERENCING_TABLE} (id, user_id) VALUES (?, ?)`,
    )
      .bind('reference-1', userIdOf(PURGED))
      .run();
    const lifecycleStore = createUserLifecycleStore(db, createSequentialIds());

    await createPurgeStore()
      .purge(userIdOf(PURGED))
      .catch(() => undefined);

    expect((await lifecycleStore.findOldestPending(userIdOf(PURGED)))?.id).toBe(
      eventIdOf(2),
    );
  });
});
