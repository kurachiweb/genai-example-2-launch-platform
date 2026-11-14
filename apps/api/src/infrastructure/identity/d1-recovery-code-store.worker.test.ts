import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
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
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import {
  insertSessions,
  readSessionIdsOf,
  sessionIdsOf,
} from '../../../test/support/user-session-rows.ts';
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
  test('replaceAllRevokingSessionsは利用者の未使用のリカバリコードの入れ替えと全セッションの削除を1つの一括の書き込みで行い、他の利用者のコードとセッションを残す', async () => {
    await insertRecoveryHashes(1, recoveryHashesOf('old', 3));
    await insertRecoveryHashes(2, recoveryHashesOf('other', 2));
    await insertSessions(1, 2);
    await insertSessions(2, 1);
    const hashes = recoveryHashesOf('new', RECOVERY_CODE_COUNT);
    const recording = createBatchRecordingD1(env.DB);

    expect(
      await new D1RecoveryCodeStore(
        createDatabase(recording.d1),
      ).replaceAllRevokingSessions(userIdOf(1), hashes),
    ).toBe('replaced');

    expect(recording.batches).toHaveLength(1);
    expect(recording.statementsOutsideBatches()).toEqual([]);
    const [statements = []] = recording.batches;
    expect(
      statements.filter((query) =>
        query.startsWith('delete from "user_sessions"'),
      ),
    ).toEqual([expect.stringContaining('exists')]);
    expect(await readRecoveryHashes(1)).toEqual([...hashes].sort());
    expect(await readSessionIdsOf(1)).toEqual([]);
    expect(await readRecoveryHashes(2)).toEqual(recoveryHashesOf('other', 2));
    expect(await readSessionIdsOf(2)).toEqual(sessionIdsOf(2, 1));
    expect(
      await createStore().consume(userIdOf(1), recoveryHashOf('old', 1)),
    ).toBe(false);
  });

  test('replaceAllRevokingSessionsは10個のリカバリコードの書き込みをバインド変数の上限内に収める', async () => {
    const { database, placeholderCounts } = createRecordingDatabase();

    await new D1RecoveryCodeStore(database).replaceAllRevokingSessions(
      userIdOf(1),
      recoveryHashesOf('new', RECOVERY_CODE_COUNT),
    );

    expectWithinBindLimit(placeholderCounts);
    expect(await readRecoveryHashes(1)).toHaveLength(RECOVERY_CODE_COUNT);
  });

  test('replaceAllRevokingSessionsは多要素認証が有効でない利用者を拒否し、コードを保存せず、残っていたコードとセッションを消さない', async () => {
    await insertUser(3);
    await insertUser(4);
    await insertTotpCredential(3, { pendingExpiresAt: T0 });
    await insertRecoveryHashes(3, recoveryHashesOf('stale', 2));
    await insertSessions(3, 1);
    await insertSessions(4, 1);
    const store = createStore();

    expect(
      await store.replaceAllRevokingSessions(
        userIdOf(3),
        recoveryHashesOf('pending', 2),
      ),
    ).toBe('not-enabled');
    expect(
      await store.replaceAllRevokingSessions(
        userIdOf(4),
        recoveryHashesOf('none', 2),
      ),
    ).toBe('not-enabled');

    expect(await readRecoveryHashes(3)).toEqual(recoveryHashesOf('stale', 2));
    expect(await readRecoveryHashes(4)).toEqual([]);
    expect(await readSessionIdsOf(3)).toEqual(sessionIdsOf(3, 1));
    expect(await readSessionIdsOf(4)).toEqual(sessionIdsOf(4, 1));
  });
});
