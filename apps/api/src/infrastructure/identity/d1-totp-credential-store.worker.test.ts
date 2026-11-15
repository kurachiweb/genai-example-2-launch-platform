import { env } from 'cloudflare:workers';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';

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
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import {
  insertSessions,
  readSessionIdsOf,
  sessionIdsOf,
} from '../../../test/support/user-session-rows.ts';
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
  test('enableRevokingSessionsは期限内の保留を有効にし、使用した時間窓とリカバリコードを同時に保存する', async () => {
    await insertTotpCredential(1, {
      sealedSecret: sealedSecretOf('pending'),
      pendingExpiresAt: after(TEN_MINUTES),
    });
    const at = after(TEN_MINUTES - 1);
    const hashes = recoveryHashesOf(1, RECOVERY_CODE_COUNT);

    expect(
      await createStore().enableRevokingSessions(
        userIdOf(1),
        sealedSecretOf('pending'),
        100,
        at,
        hashes,
      ),
    ).toBe('enabled');

    expect(await readCredential(1)).toEqual({
      sealedSecret: sealedSecretOf('pending'),
      enabledAt: at,
      pendingExpiresAt: null,
      lastUsedStep: 100,
    });
    expect(await readRecoveryHashes(1)).toEqual([...hashes].sort());
  });

  test('enableRevokingSessionsは10個のリカバリコードの書き込みをバインド変数の上限内に収める', async () => {
    await insertTotpCredential(1, { pendingExpiresAt: after(TEN_MINUTES) });
    const { database, placeholderCounts } = createRecordingDatabase();

    await new D1TotpCredentialStore(database).enableRevokingSessions(
      userIdOf(1),
      sealedSecretOf('1'),
      100,
      T0,
      recoveryHashesOf(1, RECOVERY_CODE_COUNT),
    );

    expectWithinBindLimit(placeholderCounts);
    expect(await readRecoveryHashes(1)).toHaveLength(RECOVERY_CODE_COUNT);
  });

  test('enableRevokingSessionsは期限ちょうどの保留を拒否し、リカバリコードを保存しない', async () => {
    await insertTotpCredential(1, { pendingExpiresAt: after(TEN_MINUTES) });

    expect(
      await createStore().enableRevokingSessions(
        userIdOf(1),
        sealedSecretOf('1'),
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

  test('enableRevokingSessionsは資格情報の無い利用者を拒否し、リカバリコードを保存しない', async () => {
    expect(
      await createStore().enableRevokingSessions(
        userIdOf(1),
        sealedSecretOf('1'),
        100,
        T0,
        recoveryHashesOf(1, RECOVERY_CODE_COUNT),
      ),
    ).toBe('not-pending');

    expect(await readCredential(1)).toBeUndefined();
    expect(await readRecoveryHashes(1)).toEqual([]);
  });

  test('enableRevokingSessionsは有効化済みの利用者を拒否し、既存のリカバリコードと時間窓を変えない', async () => {
    await insertTotpCredential(1, { enabledAt: T0, lastUsedStep: 42 });
    const existing = recoveryHashesOf(1, 2);
    await insertRecoveryHashes(1, existing);

    expect(
      await createStore().enableRevokingSessions(
        userIdOf(1),
        sealedSecretOf('1'),
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

  test('enableRevokingSessionsは照合した秘密鍵と異なる秘密鍵の保留を拒否し、有効にせずリカバリコードを保存しない', async () => {
    await insertTotpCredential(1, {
      sealedSecret: sealedSecretOf('restarted'),
      pendingExpiresAt: after(TEN_MINUTES),
    });
    const existing = recoveryHashesOf(8, 2);
    await insertRecoveryHashes(1, existing);

    expect(
      await createStore().enableRevokingSessions(
        userIdOf(1),
        sealedSecretOf('verified'),
        100,
        T0,
        recoveryHashesOf(1, RECOVERY_CODE_COUNT),
      ),
    ).toBe('not-pending');

    expect(await readCredential(1)).toEqual({
      sealedSecret: sealedSecretOf('restarted'),
      enabledAt: null,
      pendingExpiresAt: after(TEN_MINUTES),
      lastUsedStep: null,
    });
    expect(await readRecoveryHashes(1)).toEqual(existing);
  });

  test('enableRevokingSessionsは保留の利用者に残っていたリカバリコードを新しいものに置き換える', async () => {
    await insertTotpCredential(1, { pendingExpiresAt: after(TEN_MINUTES) });
    await insertRecoveryHashes(1, recoveryHashesOf(8, 2));
    const hashes = recoveryHashesOf(1, RECOVERY_CODE_COUNT);

    expect(
      await createStore().enableRevokingSessions(
        userIdOf(1),
        sealedSecretOf('1'),
        100,
        T0,
        hashes,
      ),
    ).toBe('enabled');

    expect(await readRecoveryHashes(1)).toEqual([...hashes].sort());
  });
});

describe('D1TotpCredentialStoreの有効化での全セッションの削除', () => {
  beforeEach(async () => {
    await insertSessions(1, 2);
    await insertSessions(2, 1);
  });

  test('enableRevokingSessionsは有効化・リカバリコードの追加・利用者の全セッションの削除を1つの一括の書き込みで行い、他の利用者のセッションを残す', async () => {
    await insertTotpCredential(1, { pendingExpiresAt: after(TEN_MINUTES) });
    const recording = createBatchRecordingD1(env.DB);

    expect(
      await new D1TotpCredentialStore(
        createDatabase(recording.d1),
      ).enableRevokingSessions(
        userIdOf(1),
        sealedSecretOf('1'),
        100,
        T0,
        recoveryHashesOf(1, RECOVERY_CODE_COUNT),
      ),
    ).toBe('enabled');

    expect(recording.batches).toHaveLength(1);
    expect(recording.statementsOutsideBatches()).toEqual([]);
    const [statements = []] = recording.batches;
    expect(
      statements.filter((query) =>
        query.startsWith('delete from "user_sessions"'),
      ),
    ).toEqual([expect.stringContaining('exists')]);
    expect(statements.at(-1)).toMatch(/^update "user_totp_credentials"/);
    expect(await readSessionIdsOf(1)).toEqual([]);
    expect(await readSessionIdsOf(2)).toEqual(sessionIdsOf(2, 1));
  });

  test.each([
    ['期限ちょうどの保留', { pendingExpiresAt: T0 }, sealedSecretOf('1')],
    ['有効化済み', { enabledAt: T0 }, sealedSecretOf('1')],
    [
      '照合と異なる秘密鍵の保留',
      { pendingExpiresAt: after(TEN_MINUTES) },
      sealedSecretOf('verified'),
    ],
  ] as const)(
    'enableRevokingSessionsは%sの利用者を拒否し、セッションを消さない',
    async (_label, credential, sealedSecret) => {
      await insertTotpCredential(1, credential);

      expect(
        await createStore().enableRevokingSessions(
          userIdOf(1),
          sealedSecret,
          100,
          T0,
          recoveryHashesOf(1, RECOVERY_CODE_COUNT),
        ),
      ).toBe('not-pending');

      expect(await readSessionIdsOf(1)).toEqual(sessionIdsOf(1, 2));
    },
  );

  test('enableRevokingSessionsは資格情報の無い利用者を拒否し、セッションを消さない', async () => {
    expect(
      await createStore().enableRevokingSessions(
        userIdOf(1),
        sealedSecretOf('1'),
        100,
        T0,
        recoveryHashesOf(1, RECOVERY_CODE_COUNT),
      ),
    ).toBe('not-pending');

    expect(await readSessionIdsOf(1)).toEqual(sessionIdsOf(1, 2));
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
  test('disableRevokingSessionsは利用者の秘密鍵・リカバリコード・全セッションを1つの一括の書き込みで削除し、他の利用者の行を残す', async () => {
    await insertTotpCredential(1, { enabledAt: T0 });
    await insertTotpCredential(2, { enabledAt: T0 });
    await insertRecoveryHashes(1, recoveryHashesOf(1, 3));
    await insertRecoveryHashes(2, recoveryHashesOf(2, 3));
    await insertSessions(1, 2);
    await insertSessions(2, 1);
    const recording = createBatchRecordingD1(env.DB);

    expect(
      await new D1TotpCredentialStore(
        createDatabase(recording.d1),
      ).disableRevokingSessions(userIdOf(1)),
    ).toBe('disabled');

    expect(recording.batches).toHaveLength(1);
    expect(recording.statementsOutsideBatches()).toEqual([]);
    const [statements = []] = recording.batches;
    expect(
      statements.filter((query) =>
        query.startsWith('delete from "user_sessions"'),
      ),
    ).toEqual([expect.stringContaining('exists')]);
    expect(statements.at(-1)).toMatch(/^delete from "user_totp_credentials"/);
    expect(await readCredential(1)).toBeUndefined();
    expect(await readRecoveryHashes(1)).toEqual([]);
    expect(await readSessionIdsOf(1)).toEqual([]);
    expect(await readCredential(2)).toMatchObject({ enabledAt: T0 });
    expect(await readRecoveryHashes(2)).toEqual(recoveryHashesOf(2, 3));
    expect(await readSessionIdsOf(2)).toEqual(sessionIdsOf(2, 1));
  });

  test('disableRevokingSessionsは有効でない利用者を拒否し、設定の途中の保留とセッションを残す', async () => {
    await insertTotpCredential(1, {
      sealedSecret: sealedSecretOf('restarted'),
      pendingExpiresAt: after(TEN_MINUTES),
    });
    await insertSessions(1, 2);
    await insertSessions(2, 1);
    const store = createStore();

    expect(await store.disableRevokingSessions(userIdOf(1))).toBe(
      'not-enabled',
    );
    expect(await store.disableRevokingSessions(userIdOf(2))).toBe(
      'not-enabled',
    );

    expect(await readCredential(1)).toMatchObject({
      sealedSecret: sealedSecretOf('restarted'),
      enabledAt: null,
    });
    expect(await readSessionIdsOf(1)).toEqual(sessionIdsOf(1, 2));
    expect(await readSessionIdsOf(2)).toEqual(sessionIdsOf(2, 1));
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
