import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { userRecoveryCodes } from '../../../db/schema/identity/user-recovery-codes.ts';
import {
  clearIdentityTables,
  createRecordingDatabase,
  db,
  expectWithinBindLimit,
  insertTotpCredential,
  insertUser,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { RecoveryCodeStore } from '../../application/identity/ports.ts';
import { D1RecoveryCodeStore } from './d1-recovery-code-store.ts';

const RECOVERY_CODE_COUNT = 10;

function createStore(): RecoveryCodeStore {
  return new D1RecoveryCodeStore(db);
}

function recoveryHashOf(label: string, index: number): string {
  return ['recovery', 'hash', label, String(index)].join('-');
}

function recoveryHashesOf(label: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    recoveryHashOf(label, index + 1),
  );
}

async function readRecoveryHashes(userIndex: number): Promise<string[]> {
  const rows = await db
    .select({ codeHash: userRecoveryCodes.codeHash })
    .from(userRecoveryCodes)
    .where(eq(userRecoveryCodes.userId, userIdOf(userIndex)))
    .orderBy(asc(userRecoveryCodes.codeHash));
  return rows.map((row) => row.codeHash);
}

async function insertRecoveryHashes(
  userIndex: number,
  hashes: readonly string[],
): Promise<void> {
  await db.insert(userRecoveryCodes).values(
    hashes.map((codeHash) => ({
      userId: userIdOf(userIndex),
      codeHash,
      createdAt: T0,
      updatedAt: T0,
    })),
  );
}

beforeEach(async () => {
  await clearIdentityTables();
  await insertUser(1);
  await insertUser(2);
  await insertTotpCredential(1, { enabledAt: T0 });
  await insertTotpCredential(2, { enabledAt: T0 });
});

describe('D1RecoveryCodeStoreの消費と数え上げ', () => {
  test('consumeは利用者の一致したリカバリコードを削除し、同じコードの2回目を拒否する', async () => {
    await insertRecoveryHashes(1, recoveryHashesOf('first', 3));
    const store = createStore();

    expect(await store.consume(userIdOf(1), recoveryHashOf('first', 2))).toBe(
      true,
    );
    expect(await store.consume(userIdOf(1), recoveryHashOf('first', 2))).toBe(
      false,
    );

    expect(await readRecoveryHashes(1)).toEqual([
      recoveryHashOf('first', 1),
      recoveryHashOf('first', 3),
    ]);
  });

  test('consumeは他の利用者のリカバリコードと無いコードを拒否し、削除しない', async () => {
    await insertRecoveryHashes(2, recoveryHashesOf('other', 1));
    const store = createStore();

    expect(await store.consume(userIdOf(1), recoveryHashOf('other', 1))).toBe(
      false,
    );
    expect(await store.consume(userIdOf(1), recoveryHashOf('none', 1))).toBe(
      false,
    );

    expect(await readRecoveryHashes(2)).toEqual([recoveryHashOf('other', 1)]);
  });

  test('countは利用者の未使用のリカバリコードの数を返す', async () => {
    await insertRecoveryHashes(1, recoveryHashesOf('first', 3));
    await insertRecoveryHashes(2, recoveryHashesOf('other', 5));
    const store = createStore();

    expect(await store.count(userIdOf(1))).toBe(3);
    await store.consume(userIdOf(1), recoveryHashOf('first', 1));
    expect(await store.count(userIdOf(1))).toBe(2);
    await insertUser(3);
    expect(await store.count(userIdOf(3))).toBe(0);
  });
});

describe('D1RecoveryCodeStoreの入れ替え', () => {
  test('replaceAllは利用者の未使用のリカバリコードをすべて新しいものに入れ替え、他の利用者のコードを残す', async () => {
    await insertRecoveryHashes(1, recoveryHashesOf('old', 3));
    await insertRecoveryHashes(2, recoveryHashesOf('other', 2));
    const hashes = recoveryHashesOf('new', RECOVERY_CODE_COUNT);

    await createStore().replaceAll(userIdOf(1), hashes);

    expect(await readRecoveryHashes(1)).toEqual([...hashes].sort());
    expect(await readRecoveryHashes(2)).toEqual(recoveryHashesOf('other', 2));
    expect(
      await createStore().consume(userIdOf(1), recoveryHashOf('old', 1)),
    ).toBe(false);
  });

  test('replaceAllは10個のリカバリコードの書き込みをバインド変数の上限内に収める', async () => {
    const { database, placeholderCounts } = createRecordingDatabase();

    await new D1RecoveryCodeStore(database).replaceAll(
      userIdOf(1),
      recoveryHashesOf('new', RECOVERY_CODE_COUNT),
    );

    expectWithinBindLimit(placeholderCounts);
    expect(await readRecoveryHashes(1)).toHaveLength(RECOVERY_CODE_COUNT);
  });

  test('replaceAllは多要素認証が有効でない利用者には古いコードを削除するだけで新しいコードを保存しない', async () => {
    await insertUser(3);
    await insertUser(4);
    await insertTotpCredential(3, { pendingExpiresAt: T0 });
    await insertRecoveryHashes(3, recoveryHashesOf('stale', 2));
    const store = createStore();

    await store.replaceAll(userIdOf(3), recoveryHashesOf('pending', 2));
    await store.replaceAll(userIdOf(4), recoveryHashesOf('none', 2));

    expect(await readRecoveryHashes(3)).toEqual([]);
    expect(await readRecoveryHashes(4)).toEqual([]);
  });
});
