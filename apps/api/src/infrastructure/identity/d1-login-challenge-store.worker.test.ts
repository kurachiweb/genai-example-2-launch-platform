import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { userLoginChallenges } from '../../../db/schema/identity/user-login-challenges.ts';
import {
  after,
  clearIdentityTables,
  db,
  insertUser,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type {
  LoginChallengeStore,
  NewLoginChallenge,
} from '../../application/identity/ports.ts';
import { D1LoginChallengeStore } from './d1-login-challenge-store.ts';

const FIVE_MINUTES = 300_000;

function createStore(): LoginChallengeStore {
  return new D1LoginChallengeStore(db);
}

function challengeIdOf(index: number): string {
  return `01JC0CHAL${String(index).padStart(17, '0')}`;
}

function challengeHashOf(index: number): string {
  return ['challenge', 'hash', String(index)].join('-');
}

function challengeOf(
  userIndex: number,
  index: number,
  overrides: Partial<NewLoginChallenge> = {},
): NewLoginChallenge {
  return {
    id: challengeIdOf(index),
    userId: userIdOf(userIndex),
    tokenHash: challengeHashOf(index),
    expiresAt: after(FIVE_MINUTES),
    ...overrides,
  };
}

async function readChallengeIds(): Promise<string[]> {
  const rows = await db
    .select({ id: userLoginChallenges.id })
    .from(userLoginChallenges)
    .orderBy(asc(userLoginChallenges.id));
  return rows.map((row) => row.id);
}

beforeEach(async () => {
  await clearIdentityTables();
  await insertUser(1);
  await insertUser(2);
});

describe('D1LoginChallengeStoreの追加と検索', () => {
  test('insertは第2要素の待ちを保存する', async () => {
    const challenge = challengeOf(1, 1);

    await createStore().insert(challenge);

    const [row] = await db
      .select({
        id: userLoginChallenges.id,
        userId: userLoginChallenges.userId,
        tokenHash: userLoginChallenges.tokenHash,
        expiresAt: userLoginChallenges.expiresAt,
      })
      .from(userLoginChallenges)
      .where(eq(userLoginChallenges.id, challengeIdOf(1)));
    expect(row).toEqual(challenge);
  });

  test('findValidは期限内の待ちの識別子と利用者を返し、期限ちょうどと無い待ちにはundefinedを返す', async () => {
    const now = after(FIVE_MINUTES);
    const store = createStore();
    await store.insert(
      challengeOf(1, 1, { expiresAt: new Date(now.getTime() + 1) }),
    );
    await store.insert(challengeOf(2, 2, { expiresAt: now }));

    expect(await store.findValid(challengeHashOf(1), now)).toEqual({
      id: challengeIdOf(1),
      userId: userIdOf(1),
    });
    expect(await store.findValid(challengeHashOf(2), now)).toBeUndefined();
    expect(await store.findValid(challengeHashOf(9), now)).toBeUndefined();
    expect(await readChallengeIds()).toEqual([
      challengeIdOf(1),
      challengeIdOf(2),
    ]);
  });
});

describe('D1LoginChallengeStoreの削除', () => {
  test('deleteは指定した待ちだけを削除する', async () => {
    const store = createStore();
    await store.insert(challengeOf(1, 1));
    await store.insert(challengeOf(1, 2));

    await store.delete(challengeIdOf(1));

    expect(await readChallengeIds()).toEqual([challengeIdOf(2)]);
    expect(await store.findValid(challengeHashOf(1), after(0))).toBeUndefined();
  });

  test('deleteExpiredは期限ちょうどを含めて期限切れの待ちを削除し、件数を返す', async () => {
    const now = after(FIVE_MINUTES);
    const store = createStore();
    await store.insert(challengeOf(1, 1, { expiresAt: now }));
    await store.insert(
      challengeOf(1, 2, { expiresAt: new Date(now.getTime() - 1) }),
    );
    await store.insert(
      challengeOf(2, 3, { expiresAt: new Date(now.getTime() + 1) }),
    );

    expect(await store.deleteExpired(now)).toBe(2);
    expect(await readChallengeIds()).toEqual([challengeIdOf(3)]);
    expect(await store.deleteExpired(now)).toBe(0);
  });
});
