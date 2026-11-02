import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { userRecoveryCodes } from '../../../db/schema/identity/user-recovery-codes.ts';
import { userTotpCredentials } from '../../../db/schema/identity/user-totp-credentials.ts';
import {
  after,
  clearIdentityTables,
  createRecordingDatabase,
  db,
  expectWithinBindLimit,
  insertTotpCredential,
  insertUser,
  T0,
  userIdOf,
} from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { TotpCredentialStore } from '../../application/identity/ports.ts';
import { D1TotpCredentialStore } from './d1-totp-credential-store.ts';

const TEN_MINUTES = 600_000;

const RECOVERY_CODE_COUNT = 10;

function createStore(): TotpCredentialStore {
  return new D1TotpCredentialStore(db);
}

function sealedSecretOf(label: string): string {
  return ['sealed', 'secret', label].join('-');
}

function recoveryHashOf(userIndex: number, index: number): string {
  return ['recovery', 'hash', String(userIndex), String(index)].join('-');
}

function recoveryHashesOf(userIndex: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    recoveryHashOf(userIndex, index + 1),
  );
}

async function readCredential(userIndex: number) {
  const [row] = await db
    .select({
      sealedSecret: userTotpCredentials.sealedSecret,
      enabledAt: userTotpCredentials.enabledAt,
      pendingExpiresAt: userTotpCredentials.pendingExpiresAt,
      lastUsedStep: userTotpCredentials.lastUsedStep,
    })
    .from(userTotpCredentials)
    .where(eq(userTotpCredentials.userId, userIdOf(userIndex)));
  return row;
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
});

describe('D1TotpCredentialStoreの検索', () => {
  test('findは保存されたTOTPの資格情報を返し、無い利用者にはundefinedを返す', async () => {
    await insertTotpCredential(1, {
      sealedSecret: sealedSecretOf('enabled'),
      enabledAt: T0,
      lastUsedStep: 42,
    });

    expect(await createStore().find(userIdOf(1))).toEqual({
      sealedSecret: sealedSecretOf('enabled'),
      enabledAt: T0,
      pendingExpiresAt: null,
      lastUsedStep: 42,
    });
    expect(await createStore().find(userIdOf(2))).toBeUndefined();
  });
});

describe('D1TotpCredentialStoreの保留の保存', () => {
  test('savePendingは資格情報の無い利用者に保留の秘密鍵を保存する', async () => {
    const expiresAt = after(TEN_MINUTES);

    expect(
      await createStore().savePending(
        userIdOf(1),
        sealedSecretOf('new'),
        expiresAt,
      ),
    ).toBe('saved');

    expect(await readCredential(1)).toEqual({
      sealedSecret: sealedSecretOf('new'),
      enabledAt: null,
      pendingExpiresAt: expiresAt,
      lastUsedStep: null,
    });
  });

  test('savePendingは期限切れを含む保留を新しい秘密鍵と期限で置き換える', async () => {
    await insertTotpCredential(1, {
      sealedSecret: sealedSecretOf('old'),
      pendingExpiresAt: T0,
      lastUsedStep: 7,
    });
    const expiresAt = after(2 * TEN_MINUTES);

    expect(
      await createStore().savePending(
        userIdOf(1),
        sealedSecretOf('replaced'),
        expiresAt,
      ),
    ).toBe('saved');

    expect(await readCredential(1)).toEqual({
      sealedSecret: sealedSecretOf('replaced'),
      enabledAt: null,
      pendingExpiresAt: expiresAt,
      lastUsedStep: null,
    });
  });

  test('savePendingは有効化済みの利用者を拒否し、資格情報を変えない', async () => {
    await insertTotpCredential(1, {
      sealedSecret: sealedSecretOf('enabled'),
      enabledAt: T0,
      lastUsedStep: 42,
    });

    expect(
      await createStore().savePending(
        userIdOf(1),
        sealedSecretOf('attacker'),
        after(TEN_MINUTES),
      ),
    ).toBe('already-enabled');

    expect(await readCredential(1)).toEqual({
      sealedSecret: sealedSecretOf('enabled'),
      enabledAt: T0,
      pendingExpiresAt: null,
      lastUsedStep: 42,
    });
  });
});

describe('D1TotpCredentialStoreの有効化', () => {
  test('enableは期限内の保留を有効にし、使用した時間窓とリカバリコードを同時に保存する', async () => {
    await insertTotpCredential(1, {
      sealedSecret: sealedSecretOf('pending'),
      pendingExpiresAt: after(TEN_MINUTES),
    });
    const at = after(TEN_MINUTES - 1);
    const hashes = recoveryHashesOf(1, RECOVERY_CODE_COUNT);

    expect(await createStore().enable(userIdOf(1), 100, at, hashes)).toBe(
      'enabled',
    );

    expect(await readCredential(1)).toEqual({
      sealedSecret: sealedSecretOf('pending'),
      enabledAt: at,
      pendingExpiresAt: null,
      lastUsedStep: 100,
    });
    expect(await readRecoveryHashes(1)).toEqual([...hashes].sort());
  });

  test('enableは10個のリカバリコードの書き込みをバインド変数の上限内に収める', async () => {
    await insertTotpCredential(1, { pendingExpiresAt: after(TEN_MINUTES) });
    const { database, placeholderCounts } = createRecordingDatabase();

    await new D1TotpCredentialStore(database).enable(
      userIdOf(1),
      100,
      T0,
      recoveryHashesOf(1, RECOVERY_CODE_COUNT),
    );

    expectWithinBindLimit(placeholderCounts);
    expect(await readRecoveryHashes(1)).toHaveLength(RECOVERY_CODE_COUNT);
  });

  test('enableは期限ちょうどの保留を拒否し、リカバリコードを保存しない', async () => {
    await insertTotpCredential(1, { pendingExpiresAt: after(TEN_MINUTES) });

    expect(
      await createStore().enable(
        userIdOf(1),
        100,
        after(TEN_MINUTES),
        recoveryHashesOf(1, RECOVERY_CODE_COUNT),
      ),
    ).toBe('not-pending');

    expect(await readCredential(1)).toMatchObject({
      enabledAt: null,
      lastUsedStep: null,
    });
    expect(await readRecoveryHashes(1)).toEqual([]);
  });

  test('enableは資格情報の無い利用者を拒否し、リカバリコードを保存しない', async () => {
    expect(
      await createStore().enable(
        userIdOf(1),
        100,
        T0,
        recoveryHashesOf(1, RECOVERY_CODE_COUNT),
      ),
    ).toBe('not-pending');

    expect(await readCredential(1)).toBeUndefined();
    expect(await readRecoveryHashes(1)).toEqual([]);
  });

  test('enableは有効化済みの利用者を拒否し、既存のリカバリコードと時間窓を変えない', async () => {
    await insertTotpCredential(1, { enabledAt: T0, lastUsedStep: 42 });
    const existing = recoveryHashesOf(1, 2);
    await insertRecoveryHashes(1, existing);

    expect(
      await createStore().enable(
        userIdOf(1),
        100,
        after(1),
        recoveryHashesOf(9, RECOVERY_CODE_COUNT),
      ),
    ).toBe('not-pending');

    expect(await readCredential(1)).toMatchObject({
      enabledAt: T0,
      lastUsedStep: 42,
    });
    expect(await readRecoveryHashes(1)).toEqual(existing);
  });

  test('enableは保留の利用者に残っていたリカバリコードを新しいものに置き換える', async () => {
    await insertTotpCredential(1, { pendingExpiresAt: after(TEN_MINUTES) });
    await insertRecoveryHashes(1, recoveryHashesOf(8, 2));
    const hashes = recoveryHashesOf(1, RECOVERY_CODE_COUNT);

    expect(await createStore().enable(userIdOf(1), 100, T0, hashes)).toBe(
      'enabled',
    );

    expect(await readRecoveryHashes(1)).toEqual([...hashes].sort());
  });
});

describe('D1TotpCredentialStoreの時間窓の更新', () => {
  test('advanceStepは使用済みの時間窓より新しいときだけ更新し、同じ時間窓と古い時間窓の2回目を拒否する', async () => {
    await insertTotpCredential(1, { enabledAt: T0 });
    const store = createStore();

    expect(await store.advanceStep(userIdOf(1), 100)).toBe(true);
    expect(await store.advanceStep(userIdOf(1), 100)).toBe(false);
    expect(await store.advanceStep(userIdOf(1), 99)).toBe(false);
    expect(await readCredential(1)).toMatchObject({ lastUsedStep: 100 });

    expect(await store.advanceStep(userIdOf(1), 101)).toBe(true);
    expect(await readCredential(1)).toMatchObject({ lastUsedStep: 101 });
  });

  test('advanceStepは有効化していない保留と資格情報の無い利用者を更新しない', async () => {
    await insertTotpCredential(1, { pendingExpiresAt: after(TEN_MINUTES) });
    const store = createStore();

    expect(await store.advanceStep(userIdOf(1), 100)).toBe(false);
    expect(await store.advanceStep(userIdOf(2), 100)).toBe(false);
    expect(await readCredential(1)).toMatchObject({ lastUsedStep: null });
  });
});

describe('D1TotpCredentialStoreの無効化と削除', () => {
  test('disableは利用者の秘密鍵とリカバリコードを削除し、他の利用者の行を残す', async () => {
    await insertTotpCredential(1, { enabledAt: T0 });
    await insertTotpCredential(2, { enabledAt: T0 });
    await insertRecoveryHashes(1, recoveryHashesOf(1, 3));
    await insertRecoveryHashes(2, recoveryHashesOf(2, 3));

    await createStore().disable(userIdOf(1));

    expect(await readCredential(1)).toBeUndefined();
    expect(await readRecoveryHashes(1)).toEqual([]);
    expect(await readCredential(2)).toMatchObject({ enabledAt: T0 });
    expect(await readRecoveryHashes(2)).toEqual(recoveryHashesOf(2, 3));
  });

  test('deleteExpiredPendingは期限ちょうどを含めて期限切れの保留だけを削除し、件数を返す', async () => {
    const now = after(TEN_MINUTES);
    await insertUser(3);
    await insertUser(4);
    await insertTotpCredential(1, { pendingExpiresAt: now });
    await insertTotpCredential(2, {
      pendingExpiresAt: new Date(now.getTime() - 1),
    });
    await insertTotpCredential(3, {
      pendingExpiresAt: new Date(now.getTime() + 1),
    });
    await insertTotpCredential(4, { enabledAt: T0 });
    const store = createStore();

    expect(await store.deleteExpiredPending(now)).toBe(2);

    expect(await readCredential(1)).toBeUndefined();
    expect(await readCredential(2)).toBeUndefined();
    expect(await readCredential(3)).toBeDefined();
    expect(await readCredential(4)).toBeDefined();
    expect(await store.deleteExpiredPending(now)).toBe(0);
  });
});
