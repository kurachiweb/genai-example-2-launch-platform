import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { adminAuthTokens } from '../../../db/schema/admin/admin-auth-tokens.ts';
import type {
  AdminAuthTokenStore,
  NewAdminAuthToken,
} from '../../application/admin/ports.ts';
import type { AdminAuthTokenPurpose } from '../../domain/admin/admin-auth-token-purpose.ts';
import { D1AdminAuthTokenStore } from './d1-admin-auth-token-store.ts';
import {
  adminEmailOf,
  adminIdOf,
  after,
  clearAdminTables,
  db,
  HOUR_MS,
  insertAdmin,
  insertInvitedAdmin,
  T0,
} from './testing/admin-store-fixtures.ts';

interface TokenRow {
  readonly adminIndex: number;
  readonly purpose: AdminAuthTokenPurpose;
  readonly index: number;
  readonly expiresAt: Date;
  readonly newEmail?: string;
}

function createStore(): AdminAuthTokenStore {
  return new D1AdminAuthTokenStore(db);
}

function tokenHashOf(index: number): string {
  return ['admin', 'token', 'hash', String(index)].join('-');
}

function tokenOf(
  adminIndex: number,
  index: number,
  overrides: Partial<NewAdminAuthToken> = {},
): NewAdminAuthToken {
  return {
    adminId: adminIdOf(adminIndex),
    purpose: 'password_reset',
    tokenHash: tokenHashOf(index),
    expiresAt: after(HOUR_MS),
    ...overrides,
  };
}

async function insertTokens(rows: readonly TokenRow[]): Promise<void> {
  for (const row of rows) {
    await db.insert(adminAuthTokens).values({
      adminId: adminIdOf(row.adminIndex),
      purpose: row.purpose,
      tokenHash: tokenHashOf(row.index),
      expiresAt: row.expiresAt,
      newEmail: row.newEmail ?? null,
      createdAt: T0,
      updatedAt: T0,
    });
  }
}

async function readTokens() {
  return db
    .select({
      adminId: adminAuthTokens.adminId,
      purpose: adminAuthTokens.purpose,
      tokenHash: adminAuthTokens.tokenHash,
      expiresAt: adminAuthTokens.expiresAt,
      newEmail: adminAuthTokens.newEmail,
    })
    .from(adminAuthTokens)
    .orderBy(asc(adminAuthTokens.tokenHash));
}

async function readTokenHashes(): Promise<string[]> {
  const rows = await readTokens();
  return rows.map((row) => row.tokenHash);
}

beforeEach(async () => {
  await clearAdminTables();
  await insertAdmin(1);
  await insertAdmin(2);
});

describe('D1AdminAuthTokenStore.replace', () => {
  test('同じ管理者・用途の未使用のトークンを消して新しいトークンを加え、他の用途と他の管理者のトークンを残す', async () => {
    await insertTokens([
      {
        adminIndex: 1,
        purpose: 'password_reset',
        index: 1,
        expiresAt: after(HOUR_MS),
      },
      {
        adminIndex: 1,
        purpose: 'email_change',
        index: 2,
        expiresAt: after(HOUR_MS),
        newEmail: adminEmailOf(8),
      },
      {
        adminIndex: 2,
        purpose: 'password_reset',
        index: 3,
        expiresAt: after(HOUR_MS),
      },
    ]);

    await createStore().replace(
      tokenOf(1, 4, { expiresAt: after(2 * HOUR_MS) }),
    );

    expect(await readTokens()).toEqual([
      {
        adminId: adminIdOf(1),
        purpose: 'email_change',
        tokenHash: tokenHashOf(2),
        expiresAt: after(HOUR_MS),
        newEmail: adminEmailOf(8),
      },
      {
        adminId: adminIdOf(2),
        purpose: 'password_reset',
        tokenHash: tokenHashOf(3),
        expiresAt: after(HOUR_MS),
        newEmail: null,
      },
      {
        adminId: adminIdOf(1),
        purpose: 'password_reset',
        tokenHash: tokenHashOf(4),
        expiresAt: after(2 * HOUR_MS),
        newEmail: null,
      },
    ]);
  });

  test('メールアドレスの変更のトークンは変更先のメールアドレスを保存する', async () => {
    await createStore().replace(
      tokenOf(1, 1, { purpose: 'email_change', newEmail: adminEmailOf(9) }),
    );

    expect(await readTokens()).toEqual([
      {
        adminId: adminIdOf(1),
        purpose: 'email_change',
        tokenHash: tokenHashOf(1),
        expiresAt: after(HOUR_MS),
        newEmail: adminEmailOf(9),
      },
    ]);
  });

  test('招待中の管理者の招待のトークンは置き換えない', async () => {
    await insertInvitedAdmin(3);
    await insertTokens([
      {
        adminIndex: 3,
        purpose: 'invitation',
        index: 1,
        expiresAt: after(HOUR_MS),
      },
    ]);

    await createStore().replace(tokenOf(3, 2));

    expect(await readTokenHashes()).toEqual([tokenHashOf(1), tokenHashOf(2)]);
  });

  test('新しいトークンの追加に失敗すれば、既存のトークンを消さない', async () => {
    await insertTokens([
      {
        adminIndex: 1,
        purpose: 'password_reset',
        index: 1,
        expiresAt: after(HOUR_MS),
      },
      {
        adminIndex: 2,
        purpose: 'password_reset',
        index: 2,
        expiresAt: after(HOUR_MS),
      },
    ]);

    await expect(createStore().replace(tokenOf(1, 2))).rejects.toThrow();

    expect(await readTokenHashes()).toEqual([tokenHashOf(1), tokenHashOf(2)]);
  });
});

describe('D1AdminAuthTokenStoreの読み取りと消費', () => {
  const now = after(HOUR_MS);

  beforeEach(async () => {
    await insertInvitedAdmin(3);
    await insertTokens([
      {
        adminIndex: 1,
        purpose: 'email_change',
        index: 1,
        expiresAt: new Date(now.getTime() + 1),
        newEmail: adminEmailOf(9),
      },
      {
        adminIndex: 3,
        purpose: 'invitation',
        index: 2,
        expiresAt: after(2 * HOUR_MS),
      },
      {
        adminIndex: 1,
        purpose: 'password_reset',
        index: 3,
        expiresAt: now,
      },
    ]);
  });

  test('findValidは期限内のトークンを消費せずに返す', async () => {
    const store = createStore();

    expect(await store.findValid('email_change', tokenHashOf(1), now)).toEqual({
      adminId: adminIdOf(1),
      newEmail: adminEmailOf(9),
    });
    expect(await store.findValid('invitation', tokenHashOf(2), now)).toEqual({
      adminId: adminIdOf(3),
      newEmail: null,
    });
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
      await store.findValid('password_reset', tokenHashOf(3), now),
    ).toBeUndefined();
    expect(
      await store.findValid('email_change', tokenHashOf(9), now),
    ).toBeUndefined();
  });

  test('consumeは期限内のトークンを削除して返し、同じトークンの2回目は見つからない', async () => {
    const store = createStore();

    expect(await store.consume('invitation', tokenHashOf(2), now)).toEqual({
      adminId: adminIdOf(3),
      newEmail: null,
    });
    expect(
      await store.consume('invitation', tokenHashOf(2), now),
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
      await store.consume('invitation', tokenHashOf(1), now),
    ).toBeUndefined();
    expect(
      await store.consume('password_reset', tokenHashOf(3), now),
    ).toBeUndefined();
    expect(await readTokenHashes()).toEqual([
      tokenHashOf(1),
      tokenHashOf(2),
      tokenHashOf(3),
    ]);
  });
});

describe('D1AdminAuthTokenStore.deleteExpired', () => {
  const now = after(HOUR_MS);

  test('期限ちょうどを含めて期限切れのトークンを削除し、件数を返す', async () => {
    await insertTokens([
      { adminIndex: 1, purpose: 'password_reset', index: 1, expiresAt: now },
      {
        adminIndex: 1,
        purpose: 'email_change',
        index: 2,
        expiresAt: new Date(now.getTime() - 1),
      },
      {
        adminIndex: 2,
        purpose: 'password_reset',
        index: 3,
        expiresAt: new Date(now.getTime() + 1),
      },
    ]);
    const store = createStore();

    expect(await store.deleteExpired(now, 500)).toBe(2);
    expect(await readTokenHashes()).toEqual([tokenHashOf(3)]);
    expect(await store.deleteExpired(now, 500)).toBe(0);
  });

  test('期限切れのトークンをlimit件までだけ削除し、残りは次の呼び出しで削除する', async () => {
    await insertTokens([
      { adminIndex: 1, purpose: 'password_reset', index: 1, expiresAt: now },
      { adminIndex: 1, purpose: 'email_change', index: 2, expiresAt: now },
      { adminIndex: 2, purpose: 'password_reset', index: 3, expiresAt: now },
    ]);
    const store = createStore();

    expect(await store.deleteExpired(now, 2)).toBe(2);
    expect(await readTokenHashes()).toHaveLength(1);
    expect(await store.deleteExpired(now, 2)).toBe(1);
    expect(await readTokenHashes()).toEqual([]);
  });
});
