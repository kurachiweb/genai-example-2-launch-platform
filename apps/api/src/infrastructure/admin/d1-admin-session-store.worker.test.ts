import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { adminSessions } from '../../../db/schema/admin/admin-sessions.ts';
import type {
  AdminSessionStore,
  NewAdminSessionRecord,
} from '../../application/admin/ports.ts';
import type { SessionPolicy } from '../../domain/auth/session-policy.ts';
import { D1AdminSessionStore } from './d1-admin-session-store.ts';
import {
  adminIdOf,
  adminSessionIdOf,
  after,
  clearAdminTables,
  db,
  HOUR_MS,
  insertAdmin,
  insertInvitedAdmin,
  T0,
} from './testing/admin-store-fixtures.ts';

const SECOND = 1000;

const POLICY: SessionPolicy = {
  idleSeconds: 100,
  absoluteSeconds: 1000,
  touchIntervalSeconds: 10,
};

function createStore(): AdminSessionStore {
  return new D1AdminSessionStore(db);
}

function sessionHashOf(index: number): string {
  return ['admin', 'session', 'hash', String(index)].join('-');
}

function sessionOf(
  adminIndex: number,
  index: number,
  overrides: Partial<NewAdminSessionRecord> = {},
): NewAdminSessionRecord {
  return {
    id: adminSessionIdOf(adminIndex, index),
    adminId: adminIdOf(adminIndex),
    tokenHash: sessionHashOf(index),
    userAgent: 'Mozilla/5.0 (test)',
    createdAt: T0,
    lastUsedAt: T0,
    absoluteExpiresAt: after(12 * HOUR_MS),
    ...overrides,
  };
}

async function insertSessions(
  sessions: readonly NewAdminSessionRecord[],
): Promise<void> {
  for (const session of sessions) {
    await db
      .insert(adminSessions)
      .values({ ...session, updatedAt: session.createdAt });
  }
}

async function readSessionIds(): Promise<string[]> {
  const rows = await db
    .select({ id: adminSessions.id })
    .from(adminSessions)
    .orderBy(asc(adminSessions.id));
  return rows.map((row) => row.id);
}

async function readSession(id: string) {
  const [row] = await db
    .select()
    .from(adminSessions)
    .where(eq(adminSessions.id, id));
  return row;
}

beforeEach(async () => {
  await clearAdminTables();
  await insertAdmin(1);
  await insertAdmin(2);
});

describe('D1AdminSessionStoreの追加と検索', () => {
  test('insertは作成日時を更新日時にしてセッションを保存する', async () => {
    const session = sessionOf(1, 1, { userAgent: null });

    await createStore().insert(session);

    expect(await readSession(session.id)).toEqual({
      ...session,
      updatedAt: T0,
    });
  });

  test('findByTokenHashはハッシュが一致するセッションを管理者の状態とともに返す', async () => {
    await insertInvitedAdmin(3, {
      role: 'moderator',
      invitationExpiresAt: after(5),
    });
    const session = sessionOf(3, 1, { lastUsedAt: after(3) });
    await insertSessions([session, sessionOf(1, 2)]);

    expect(await createStore().findByTokenHash(sessionHashOf(1))).toEqual({
      ...session,
      admin: {
        id: adminIdOf(3),
        role: 'moderator',
        status: 'invited',
        invitationExpiresAt: after(5),
      },
    });
  });

  test('findByTokenHashは一致するセッションが無ければundefinedを返す', async () => {
    await insertSessions([sessionOf(1, 1)]);

    expect(
      await createStore().findByTokenHash(sessionHashOf(9)),
    ).toBeUndefined();
  });

  test('touchは最終利用の日時を更新し、他のセッションを変えない', async () => {
    await insertSessions([sessionOf(1, 1), sessionOf(1, 2)]);

    await createStore().touch(adminSessionIdOf(1, 1), after(20 * SECOND));

    expect(await readSession(adminSessionIdOf(1, 1))).toMatchObject({
      lastUsedAt: after(20 * SECOND),
      updatedAt: after(20 * SECOND),
      createdAt: T0,
    });
    expect(await readSession(adminSessionIdOf(1, 2))).toMatchObject({
      lastUsedAt: T0,
      updatedAt: T0,
    });
  });
});

describe('D1AdminSessionStore.deleteOne', () => {
  beforeEach(async () => {
    await insertSessions([sessionOf(1, 1), sessionOf(1, 2), sessionOf(2, 3)]);
  });

  test('管理者自身のセッションを削除して真を返す', async () => {
    expect(
      await createStore().deleteOne(adminIdOf(1), adminSessionIdOf(1, 2)),
    ).toBe(true);

    expect(await readSessionIds()).toEqual([
      adminSessionIdOf(1, 1),
      adminSessionIdOf(2, 3),
    ]);
  });

  test('他の管理者のセッションと無いセッションを削除せず偽を返す', async () => {
    const store = createStore();

    expect(await store.deleteOne(adminIdOf(1), adminSessionIdOf(2, 3))).toBe(
      false,
    );
    expect(await store.deleteOne(adminIdOf(1), adminSessionIdOf(1, 9))).toBe(
      false,
    );

    expect(await readSessionIds()).toHaveLength(3);
  });
});

describe('D1AdminSessionStore.deleteExpired', () => {
  const now = after(HOUR_MS);
  const idleBoundary = new Date(now.getTime() - POLICY.idleSeconds * SECOND);

  test('アイドルまたは絶対の期限ちょうどを含めて期限切れのセッションを削除し、件数を返す', async () => {
    await insertSessions([
      sessionOf(1, 1, { lastUsedAt: idleBoundary }),
      sessionOf(1, 2, { lastUsedAt: new Date(idleBoundary.getTime() + 1) }),
      sessionOf(1, 3, { lastUsedAt: now, absoluteExpiresAt: now }),
      sessionOf(2, 4, {
        lastUsedAt: now,
        absoluteExpiresAt: new Date(now.getTime() + 1),
      }),
      sessionOf(2, 5, {
        lastUsedAt: new Date(idleBoundary.getTime() - SECOND),
        absoluteExpiresAt: new Date(now.getTime() - SECOND),
      }),
    ]);

    expect(await createStore().deleteExpired(now, POLICY, 500)).toBe(3);

    expect(await readSessionIds()).toEqual([
      adminSessionIdOf(1, 2),
      adminSessionIdOf(2, 4),
    ]);
  });

  test('期限切れのセッションをlimit件までだけ削除し、残りは次の呼び出しで削除する', async () => {
    await insertSessions([
      sessionOf(1, 1, { lastUsedAt: idleBoundary }),
      sessionOf(1, 2, { lastUsedAt: idleBoundary }),
      sessionOf(2, 3, { lastUsedAt: idleBoundary }),
      sessionOf(2, 4, { lastUsedAt: now }),
    ]);
    const store = createStore();

    expect(await store.deleteExpired(now, POLICY, 2)).toBe(2);
    expect(await readSessionIds()).toHaveLength(2);
    expect(await store.deleteExpired(now, POLICY, 2)).toBe(1);
    expect(await readSessionIds()).toEqual([adminSessionIdOf(2, 4)]);
  });

  test('期限切れのセッションが無ければ0を返す', async () => {
    await insertSessions([sessionOf(1, 1, { lastUsedAt: now })]);

    expect(await createStore().deleteExpired(now, POLICY, 500)).toBe(0);

    expect(await readSessionIds()).toEqual([adminSessionIdOf(1, 1)]);
  });
});
