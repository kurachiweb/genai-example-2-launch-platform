import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { userSessions } from '../../../db/schema/identity/user-sessions.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type {
  NewSessionRecord,
  UserSessionStore,
} from '../../application/identity/ports.ts';
import type { SessionPolicy } from '../../domain/auth/session-policy.ts';
import { D1UserSessionStore } from './d1-user-session-store.ts';

const DAY = 86_400_000;

const SECOND = 1000;

const POLICY: SessionPolicy = {
  idleSeconds: 100,
  absoluteSeconds: 1000,
  touchIntervalSeconds: 10,
};

function createStore(): UserSessionStore {
  return new D1UserSessionStore(db);
}

function sessionIdOf(index: number): string {
  return `01JC0SESS${String(index).padStart(17, '0')}`;
}

function sessionHashOf(index: number): string {
  return ['session', 'hash', String(index)].join('-');
}

function sessionOf(
  userIndex: number,
  index: number,
  overrides: Partial<NewSessionRecord> = {},
): NewSessionRecord {
  return {
    id: sessionIdOf(index),
    userId: userIdOf(userIndex),
    tokenHash: sessionHashOf(index),
    userAgent: 'Mozilla/5.0 (test)',
    createdAt: T0,
    lastUsedAt: T0,
    absoluteExpiresAt: after(90 * DAY),
    ...overrides,
  };
}

async function insertSessions(
  sessions: readonly NewSessionRecord[],
): Promise<void> {
  for (const session of sessions) {
    await db
      .insert(userSessions)
      .values({ ...session, updatedAt: session.createdAt });
  }
}

async function readSessionIds(): Promise<string[]> {
  const rows = await db
    .select({ id: userSessions.id })
    .from(userSessions)
    .orderBy(asc(userSessions.id));
  return rows.map((row) => row.id);
}

async function readSession(index: number) {
  const [row] = await db
    .select()
    .from(userSessions)
    .where(eq(userSessions.id, sessionIdOf(index)));
  return row;
}

beforeEach(async () => {
  await clearIdentityTables();
  await insertUser(1);
  await insertUser(2);
});

describe('D1UserSessionStoreの追加と検索', () => {
  test('insertは作成日時を更新日時にしてセッションを保存する', async () => {
    const session = sessionOf(1, 1, { userAgent: null });

    await createStore().insert(session);

    expect(await readSession(1)).toEqual({ ...session, updatedAt: T0 });
  });

  test('findByTokenHashはハッシュが一致するセッションを利用者の状態とともに返す', async () => {
    await insertUser(3, {
      status: 'suspended',
      emailVerifiedAt: after(5),
      deletedAt: after(7),
    });
    const session = sessionOf(3, 1, { lastUsedAt: after(3) });
    await insertSessions([session, sessionOf(1, 2)]);

    expect(await createStore().findByTokenHash(sessionHashOf(1))).toEqual({
      ...session,
      user: {
        id: userIdOf(3),
        status: 'suspended',
        emailVerifiedAt: after(5),
        deletedAt: after(7),
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

    await createStore().touch(sessionIdOf(1), after(20 * SECOND));

    expect(await readSession(1)).toMatchObject({
      lastUsedAt: after(20 * SECOND),
      updatedAt: after(20 * SECOND),
      createdAt: T0,
    });
    expect(await readSession(2)).toMatchObject({
      lastUsedAt: T0,
      updatedAt: T0,
    });
  });

  test('listByUserは利用者のセッションだけを最終利用の新しい順に返す', async () => {
    const older = sessionOf(1, 1, { lastUsedAt: after(10) });
    const newer = sessionOf(1, 2, { lastUsedAt: after(30) });
    const middle = sessionOf(1, 3, { lastUsedAt: after(20) });
    await insertSessions([older, newer, middle, sessionOf(2, 4)]);

    expect(await createStore().listByUser(userIdOf(1))).toEqual([
      newer,
      middle,
      older,
    ]);
  });

  test('listByUserはセッションの無い利用者に空の配列を返す', async () => {
    await insertSessions([sessionOf(1, 1)]);

    expect(await createStore().listByUser(userIdOf(2))).toEqual([]);
  });
});

describe('D1UserSessionStoreの失効', () => {
  beforeEach(async () => {
    await insertSessions([
      sessionOf(1, 1),
      sessionOf(1, 2),
      sessionOf(1, 3),
      sessionOf(2, 4),
    ]);
  });

  test('deleteOneは利用者自身のセッションを削除して真を返す', async () => {
    expect(await createStore().deleteOne(userIdOf(1), sessionIdOf(2))).toBe(
      true,
    );

    expect(await readSessionIds()).toEqual([
      sessionIdOf(1),
      sessionIdOf(3),
      sessionIdOf(4),
    ]);
  });

  test('deleteOneは他の利用者のセッションと無いセッションを削除せず偽を返す', async () => {
    const store = createStore();

    expect(await store.deleteOne(userIdOf(1), sessionIdOf(4))).toBe(false);
    expect(await store.deleteOne(userIdOf(1), sessionIdOf(9))).toBe(false);

    expect(await readSessionIds()).toEqual([
      sessionIdOf(1),
      sessionIdOf(2),
      sessionIdOf(3),
      sessionIdOf(4),
    ]);
  });

  test('deleteOthersは残すセッション以外の利用者のセッションを削除して件数を返す', async () => {
    expect(await createStore().deleteOthers(userIdOf(1), sessionIdOf(2))).toBe(
      2,
    );

    expect(await readSessionIds()).toEqual([sessionIdOf(2), sessionIdOf(4)]);
  });

  test('deleteOthersは他に削除するセッションが無ければ0を返す', async () => {
    expect(await createStore().deleteOthers(userIdOf(2), sessionIdOf(4))).toBe(
      0,
    );

    expect(await readSessionIds()).toHaveLength(4);
  });
});

describe('D1UserSessionStoreの期限切れの削除', () => {
  const now = after(DAY);
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

    expect(await createStore().deleteExpired(now, POLICY)).toBe(3);

    expect(await readSessionIds()).toEqual([sessionIdOf(2), sessionIdOf(4)]);
  });

  test('期限切れのセッションが無ければ0を返す', async () => {
    await insertSessions([sessionOf(1, 1, { lastUsedAt: now })]);

    expect(await createStore().deleteExpired(now, POLICY)).toBe(0);

    expect(await readSessionIds()).toEqual([sessionIdOf(1)]);
  });
});
