import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { adminLoginChallenges } from '../../../db/schema/admin/admin-login-challenges.ts';
import type {
  AdminLoginChallengeStore,
  NewAdminLoginChallenge,
} from '../../application/admin/ports.ts';
import { D1AdminLoginChallengeStore } from './d1-admin-login-challenge-store.ts';
import {
  adminIdOf,
  after,
  clearAdminTables,
  db,
  insertAdmin,
  T0,
} from './testing/admin-store-fixtures.ts';

const FIVE_MINUTES = 300_000;

function createStore(): AdminLoginChallengeStore {
  return new D1AdminLoginChallengeStore(db);
}

function challengeIdOf(index: number): string {
  return `01JC0CHLG${String(index).padStart(17, '0')}`;
}

function challengeHashOf(index: number): string {
  return ['admin', 'challenge', 'hash', String(index)].join('-');
}

function challengeOf(
  adminIndex: number,
  index: number,
  expiresAt: Date = after(FIVE_MINUTES),
): NewAdminLoginChallenge {
  return {
    id: challengeIdOf(index),
    adminId: adminIdOf(adminIndex),
    tokenHash: challengeHashOf(index),
    expiresAt,
  };
}

async function insertChallenges(
  challenges: readonly NewAdminLoginChallenge[],
): Promise<void> {
  for (const challenge of challenges) {
    await db
      .insert(adminLoginChallenges)
      .values({ ...challenge, createdAt: T0, updatedAt: T0 });
  }
}

async function readChallenges() {
  return db
    .select({
      id: adminLoginChallenges.id,
      adminId: adminLoginChallenges.adminId,
      tokenHash: adminLoginChallenges.tokenHash,
      expiresAt: adminLoginChallenges.expiresAt,
    })
    .from(adminLoginChallenges)
    .orderBy(asc(adminLoginChallenges.id));
}

async function readChallengeIds(): Promise<string[]> {
  const rows = await readChallenges();
  return rows.map((row) => row.id);
}

beforeEach(async () => {
  await clearAdminTables();
  await insertAdmin(1);
  await insertAdmin(2);
});

describe('D1AdminLoginChallengeStoreの追加と検索', () => {
  test('insertは第2要素の待ちをハッシュで保存する', async () => {
    const challenge = challengeOf(1, 1);

    await createStore().insert(challenge);

    expect(await readChallenges()).toEqual([challenge]);
  });

  test('findValidは期限内の待ちの識別子と管理者を返し、期限ちょうどと無い待ちにはundefinedを返す', async () => {
    const now = after(FIVE_MINUTES);
    await insertChallenges([
      challengeOf(1, 1, new Date(now.getTime() + 1)),
      challengeOf(2, 2, now),
    ]);
    const store = createStore();

    expect(await store.findValid(challengeHashOf(1), now)).toEqual({
      id: challengeIdOf(1),
      adminId: adminIdOf(1),
    });
    expect(await store.findValid(challengeHashOf(2), now)).toBeUndefined();
    expect(await store.findValid(challengeHashOf(9), now)).toBeUndefined();
  });
});

describe('D1AdminLoginChallengeStoreの削除', () => {
  test('deleteは指定した待ちだけを削除する', async () => {
    await insertChallenges([challengeOf(1, 1), challengeOf(1, 2)]);

    await createStore().delete(challengeIdOf(1));

    expect(await readChallengeIds()).toEqual([challengeIdOf(2)]);
  });

  test('deleteExpiredは期限ちょうどを含めて期限切れの待ちを削除し、件数を返す', async () => {
    const now = after(FIVE_MINUTES);
    await insertChallenges([
      challengeOf(1, 1, now),
      challengeOf(1, 2, new Date(now.getTime() - 1)),
      challengeOf(2, 3, new Date(now.getTime() + 1)),
    ]);
    const store = createStore();

    expect(await store.deleteExpired(now, 500)).toBe(2);
    expect(await readChallengeIds()).toEqual([challengeIdOf(3)]);
    expect(await store.deleteExpired(now, 500)).toBe(0);
  });

  test('deleteExpiredは期限切れの待ちをlimit件までだけ削除し、残りは次の呼び出しで削除する', async () => {
    const now = after(FIVE_MINUTES);
    await insertChallenges([
      challengeOf(1, 1, now),
      challengeOf(1, 2, now),
      challengeOf(2, 3, now),
    ]);
    const store = createStore();

    expect(await store.deleteExpired(now, 2)).toBe(2);
    expect(await readChallengeIds()).toHaveLength(1);
    expect(await store.deleteExpired(now, 2)).toBe(1);
    expect(await readChallengeIds()).toEqual([]);
  });
});
