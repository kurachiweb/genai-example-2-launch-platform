import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { userAuthTokens } from '../../../db/schema/identity/user-auth-tokens.ts';
import {
  after,
  clearIdentityTables,
  db,
  emailOf,
  insertUser,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type {
  AuthTokenStore,
  NewAuthToken,
} from '../../application/identity/ports.ts';
import { D1AuthTokenStore } from './d1-auth-token-store.ts';

const HOUR = 3_600_000;

function createStore(): AuthTokenStore {
  return new D1AuthTokenStore(db);
}

function tokenIdOf(index: number): string {
  return `01JC0TOKN${String(index).padStart(17, '0')}`;
}

function tokenHashOf(index: number): string {
  return ['token', 'hash', String(index)].join('-');
}

function tokenOf(
  userIndex: number,
  index: number,
  overrides: Partial<NewAuthToken> = {},
): NewAuthToken {
  return {
    userId: userIdOf(userIndex),
    purpose: 'email_verification',
    tokenHash: tokenHashOf(index),
    expiresAt: after(HOUR),
    ...overrides,
  };
}

async function insertTokens(
  entries: readonly { readonly index: number; readonly token: NewAuthToken }[],
): Promise<void> {
  for (const { index, token } of entries) {
    await db.insert(userAuthTokens).values({
      ...token,
      id: tokenIdOf(index),
      createdAt: T0,
      updatedAt: T0,
    });
  }
}

async function readTokens() {
  return db
    .select({
      userId: userAuthTokens.userId,
      purpose: userAuthTokens.purpose,
      tokenHash: userAuthTokens.tokenHash,
      expiresAt: userAuthTokens.expiresAt,
      newEmail: userAuthTokens.newEmail,
      pendingPasswordHash: userAuthTokens.pendingPasswordHash,
    })
    .from(userAuthTokens)
    .orderBy(asc(userAuthTokens.tokenHash));
}

async function readTokenHashes(): Promise<string[]> {
  const rows = await readTokens();
  return rows.map((row) => row.tokenHash);
}

beforeEach(async () => {
  await clearIdentityTables();
  await insertUser(1);
  await insertUser(2);
});

describe('D1AuthTokenStoreのreplace', () => {
  test('同じ利用者・用途の未使用のトークンを消して新しいトークンを加え、他の用途と他の利用者のトークンを残す', async () => {
    await insertTokens([
      { index: 1, token: tokenOf(1, 1) },
      { index: 2, token: tokenOf(1, 2) },
      { index: 3, token: tokenOf(1, 3, { purpose: 'password_reset' }) },
      { index: 4, token: tokenOf(2, 4) },
    ]);

    await createStore().replace(tokenOf(1, 5, { expiresAt: after(2 * HOUR) }));

    expect(await readTokens()).toEqual([
      {
        userId: userIdOf(1),
        purpose: 'password_reset',
        tokenHash: tokenHashOf(3),
        expiresAt: after(HOUR),
        newEmail: null,
        pendingPasswordHash: null,
      },
      {
        userId: userIdOf(2),
        purpose: 'email_verification',
        tokenHash: tokenHashOf(4),
        expiresAt: after(HOUR),
        newEmail: null,
        pendingPasswordHash: null,
      },
      {
        userId: userIdOf(1),
        purpose: 'email_verification',
        tokenHash: tokenHashOf(5),
        expiresAt: after(2 * HOUR),
        newEmail: null,
        pendingPasswordHash: null,
      },
    ]);
  });

  test('変更先のメールアドレスと変更後のパスワードのハッシュを保存する', async () => {
    const store = createStore();

    await store.replace(
      tokenOf(1, 1, { purpose: 'email_change', newEmail: emailOf(9) }),
    );
    await store.replace(
      tokenOf(1, 2, {
        purpose: 'password_change',
        pendingPasswordHash: 'pending-password-hash',
      }),
    );

    expect(await readTokens()).toEqual([
      expect.objectContaining({
        purpose: 'email_change',
        newEmail: emailOf(9),
        pendingPasswordHash: null,
      }),
      expect.objectContaining({
        purpose: 'password_change',
        newEmail: null,
        pendingPasswordHash: 'pending-password-hash',
      }),
    ]);
  });

  test('新しいトークンの追加に失敗すれば、既存のトークンを消さない', async () => {
    await insertTokens([
      { index: 1, token: tokenOf(1, 1) },
      { index: 2, token: tokenOf(2, 2) },
    ]);

    await expect(createStore().replace(tokenOf(1, 2))).rejects.toThrow();

    expect(await readTokenHashes()).toEqual([tokenHashOf(1), tokenHashOf(2)]);
  });
});

describe('D1AuthTokenStoreの読み取りと消費', () => {
  const now = after(HOUR);

  beforeEach(async () => {
    await insertTokens([
      {
        index: 1,
        token: tokenOf(1, 1, {
          purpose: 'email_change',
          newEmail: emailOf(9),
          expiresAt: new Date(now.getTime() + 1),
        }),
      },
      {
        index: 2,
        token: tokenOf(1, 2, {
          purpose: 'password_change',
          pendingPasswordHash: 'pending-password-hash',
          expiresAt: after(2 * HOUR),
        }),
      },
      { index: 3, token: tokenOf(1, 3, { expiresAt: now }) },
    ]);
  });

  test('findValidは期限内のトークンを消費せずに返す', async () => {
    const store = createStore();

    expect(await store.findValid('email_change', tokenHashOf(1), now)).toEqual({
      userId: userIdOf(1),
      newEmail: emailOf(9),
      pendingPasswordHash: null,
    });
    expect(
      await store.findValid('email_change', tokenHashOf(1), now),
    ).toBeDefined();
    expect(await readTokenHashes()).toEqual([
      tokenHashOf(1),
      tokenHashOf(2),
      tokenHashOf(3),
    ]);
  });

  test('findValidは用途の違うトークン・期限ちょうどのトークン・無いトークンにundefinedを返す', async () => {
    const store = createStore();

    expect(
      await store.findValid('password_reset', tokenHashOf(1), now),
    ).toBeUndefined();
    expect(
      await store.findValid('email_verification', tokenHashOf(3), now),
    ).toBeUndefined();
    expect(
      await store.findValid('email_change', tokenHashOf(9), now),
    ).toBeUndefined();
  });

  test('consumeは期限内のトークンを削除して返し、同じトークンの2回目は見つからない', async () => {
    const store = createStore();

    expect(await store.consume('password_change', tokenHashOf(2), now)).toEqual(
      {
        userId: userIdOf(1),
        newEmail: null,
        pendingPasswordHash: 'pending-password-hash',
      },
    );
    expect(
      await store.consume('password_change', tokenHashOf(2), now),
    ).toBeUndefined();
    expect(await readTokenHashes()).toEqual([tokenHashOf(1), tokenHashOf(3)]);
  });

  test('同じトークンを並行して消費しても、返すのは1回だけになる', async () => {
    const store = createStore();

    const results = await Promise.all([
      store.consume('email_change', tokenHashOf(1), now),
      store.consume('email_change', tokenHashOf(1), now),
    ]);

    expect(results.filter((result) => result !== undefined)).toHaveLength(1);
  });

  test('consumeは用途の違うトークンと期限ちょうどのトークンを削除せずundefinedを返す', async () => {
    const store = createStore();

    expect(
      await store.consume('password_reset', tokenHashOf(1), now),
    ).toBeUndefined();
    expect(
      await store.consume('email_verification', tokenHashOf(3), now),
    ).toBeUndefined();
    expect(await readTokenHashes()).toEqual([
      tokenHashOf(1),
      tokenHashOf(2),
      tokenHashOf(3),
    ]);
  });
});

describe('D1AuthTokenStoreの期限切れの削除', () => {
  test('期限ちょうどを含めて期限切れのトークンを削除し、件数を返す', async () => {
    const now = after(HOUR);
    await insertTokens([
      { index: 1, token: tokenOf(1, 1, { expiresAt: now }) },
      {
        index: 2,
        token: tokenOf(1, 2, {
          purpose: 'password_reset',
          expiresAt: new Date(now.getTime() - 1),
        }),
      },
      {
        index: 3,
        token: tokenOf(2, 3, { expiresAt: new Date(now.getTime() + 1) }),
      },
    ]);

    const store = createStore();

    expect(await store.deleteExpired(now)).toBe(2);
    expect(await readTokenHashes()).toEqual([tokenHashOf(3)]);
    expect(await store.deleteExpired(now)).toBe(0);
  });
});
