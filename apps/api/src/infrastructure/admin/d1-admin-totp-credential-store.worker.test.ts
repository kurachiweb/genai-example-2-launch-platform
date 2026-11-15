import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import type {
  AdminTotpCredentialStore,
  AdminTotpPendingCommit,
} from '../../application/admin/ports.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import { D1AdminTotpCredentialStore } from './d1-admin-totp-credential-store.ts';
import {
  adminIdOf,
  adminSessionIdsOf,
  after,
  clearAdminTables,
  db,
  insertAdmin,
  insertAdminRecoveryHashes,
  insertAdminSessions,
  insertAdminTotpCredential,
  insertInvitedAdmin,
  placeholderCountOf,
  readAdminRecoveryHashes,
  readAdminSessionIdsOf,
  readAdminTotpCredential,
  T0,
} from './testing/admin-store-fixtures.ts';

const TEN_MINUTES = 600_000;

const MAX_BOUND_PARAMETERS = 100;

const CURRENT_SECRET = 'sealed-secret-current';

const PENDING_SECRET = 'sealed-secret-pending';

const AT = after(60_000);

function createStore(): AdminTotpCredentialStore {
  return new D1AdminTotpCredentialStore(db);
}

function recoveryHashesOf(label: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `recovery-${label}-${String(index).padStart(2, '0')}`,
  );
}

function commitOf(
  overrides: Partial<AdminTotpPendingCommit> = {},
): AdminTotpPendingCommit {
  return {
    pendingSealedSecret: PENDING_SECRET,
    step: 200,
    at: AT,
    recoveryHashes: recoveryHashesOf('new', 10),
    ...overrides,
  };
}

async function insertEnabledCredential(
  adminIndex: number,
  columns: Parameters<typeof insertAdminTotpCredential>[1] = {},
): Promise<void> {
  await insertAdminTotpCredential(adminIndex, {
    sealedSecret: CURRENT_SECRET,
    enabledAt: T0,
    lastUsedStep: 100,
    ...columns,
  });
}

beforeEach(async () => {
  await clearAdminTables();
  await insertAdmin(1);
  await insertAdmin(2);
});

describe('D1AdminTotpCredentialStore.find', () => {
  test('保存された現在の設定と保留を返し、無い管理者にはundefinedを返す', async () => {
    await insertEnabledCredential(1, {
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: after(TEN_MINUTES),
    });
    const store = createStore();

    expect(await store.find(adminIdOf(1))).toEqual({
      sealedSecret: CURRENT_SECRET,
      enabledAt: T0,
      lastUsedStep: 100,
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: after(TEN_MINUTES),
    });
    expect(await store.find(adminIdOf(2))).toBeUndefined();
  });
});

describe('D1AdminTotpCredentialStore.savePending', () => {
  test('資格情報の無い招待中の管理者に、現在の設定を持たない保留を保存する', async () => {
    await insertInvitedAdmin(3);

    await createStore().savePending(
      adminIdOf(3),
      PENDING_SECRET,
      after(TEN_MINUTES),
    );

    expect(await readAdminTotpCredential(3)).toEqual({
      sealedSecret: null,
      enabledAt: null,
      lastUsedStep: null,
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: after(TEN_MINUTES),
    });
  });

  test('有効な設定を持つ管理者には保留の列だけを書き、現在の設定を変えない', async () => {
    await insertEnabledCredential(1);

    await createStore().savePending(
      adminIdOf(1),
      PENDING_SECRET,
      after(TEN_MINUTES),
    );

    expect(await readAdminTotpCredential(1)).toEqual({
      sealedSecret: CURRENT_SECRET,
      enabledAt: T0,
      lastUsedStep: 100,
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: after(TEN_MINUTES),
    });
  });

  test('期限切れを含む以前の保留を新しい秘密鍵と期限で置き換える', async () => {
    await insertEnabledCredential(1, {
      pendingSealedSecret: 'sealed-secret-old',
      pendingExpiresAt: T0,
    });

    await createStore().savePending(
      adminIdOf(1),
      PENDING_SECRET,
      after(2 * TEN_MINUTES),
    );

    expect(await readAdminTotpCredential(1)).toMatchObject({
      sealedSecret: CURRENT_SECRET,
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: after(2 * TEN_MINUTES),
    });
  });
});

describe('D1AdminTotpCredentialStore.commitPendingRevokingSessions', () => {
  beforeEach(async () => {
    await insertAdminSessions(1, 2);
    await insertAdminSessions(2, 1);
    await insertAdminRecoveryHashes(1, recoveryHashesOf('old', 3));
    await insertAdminRecoveryHashes(2, recoveryHashesOf('other', 1));
  });

  test('保留と現在の設定の入れ替え・リカバリコードの置き換え・全セッションの削除を1つの一括の書き込みで行い、他の管理者の行を残す', async () => {
    await insertEnabledCredential(1, {
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: after(TEN_MINUTES),
    });
    await insertEnabledCredential(2);
    const recording = createBatchRecordingD1(env.DB);

    expect(
      await new D1AdminTotpCredentialStore(
        createDatabase(recording.d1),
      ).commitPendingRevokingSessions(adminIdOf(1), commitOf()),
    ).toBe('committed');

    expect(recording.batches).toHaveLength(1);
    expect(recording.statementsOutsideBatches()).toEqual([]);
    const [statements = []] = recording.batches;
    expect(statements.at(-1)).toMatch(/^update "admin_totp_credentials"/u);
    for (const query of statements) {
      expect(placeholderCountOf(query)).toBeLessThanOrEqual(
        MAX_BOUND_PARAMETERS,
      );
    }
    expect(await readAdminTotpCredential(1)).toEqual({
      sealedSecret: PENDING_SECRET,
      enabledAt: T0,
      lastUsedStep: 200,
      pendingSealedSecret: null,
      pendingExpiresAt: null,
    });
    expect(await readAdminRecoveryHashes(1)).toEqual(
      recoveryHashesOf('new', 10),
    );
    expect(await readAdminSessionIdsOf(1)).toEqual([]);
    expect(await readAdminRecoveryHashes(2)).toEqual(
      recoveryHashesOf('other', 1),
    );
    expect(await readAdminSessionIdsOf(2)).toEqual(adminSessionIdsOf(2, 1));
    expect(await readAdminTotpCredential(2)).toMatchObject({
      sealedSecret: CURRENT_SECRET,
    });
  });

  test.each([
    [
      '期限ちょうどの保留',
      { pendingSealedSecret: PENDING_SECRET, pendingExpiresAt: AT },
      true,
    ],
    [
      '照合と異なる秘密鍵の保留',
      {
        pendingSealedSecret: 'sealed-secret-restarted',
        pendingExpiresAt: after(TEN_MINUTES),
      },
      true,
    ],
    ['保留の無い設定', {}, true],
    [
      '有効な設定の無い招待の途中の保留',
      {
        sealedSecret: null,
        enabledAt: null,
        lastUsedStep: null,
        pendingSealedSecret: PENDING_SECRET,
        pendingExpiresAt: after(TEN_MINUTES),
      },
      true,
    ],
    ['資格情報の無い管理者', {}, false],
  ] as const)(
    '%sは入れ替えずにnot-pendingを返し、現在の設定・リカバリコード・セッションを変えない',
    async (_label, columns, hasCredential) => {
      if (hasCredential) {
        await insertEnabledCredential(1, columns);
      }
      const before = await readAdminTotpCredential(1);

      expect(
        await createStore().commitPendingRevokingSessions(
          adminIdOf(1),
          commitOf(),
        ),
      ).toBe('not-pending');

      expect(await readAdminTotpCredential(1)).toEqual(before);
      expect(await readAdminRecoveryHashes(1)).toEqual(
        recoveryHashesOf('old', 3),
      );
      expect(await readAdminSessionIdsOf(1)).toEqual(adminSessionIdsOf(1, 2));
    },
  );
});

describe('D1AdminTotpCredentialStore.advanceStep', () => {
  test('使用済みの時間窓より新しいときだけ更新し、同じ時間窓と前の時間窓の認証コードを拒否する', async () => {
    await insertEnabledCredential(1);
    const store = createStore();

    expect(await store.advanceStep(adminIdOf(1), 100)).toBe(false);
    expect(await store.advanceStep(adminIdOf(1), 99)).toBe(false);
    expect(await store.advanceStep(adminIdOf(1), 101)).toBe(true);
    expect(await store.advanceStep(adminIdOf(1), 101)).toBe(false);

    expect(await readAdminTotpCredential(1)).toMatchObject({
      lastUsedStep: 101,
    });
  });

  test('使用済みの時間窓の無い有効な設定は最初の認証コードで更新する', async () => {
    await insertEnabledCredential(1, { lastUsedStep: null });

    expect(await createStore().advanceStep(adminIdOf(1), 1)).toBe(true);
  });

  test('有効な設定の無い保留と資格情報の無い管理者を更新しない', async () => {
    await insertInvitedAdmin(3);
    await insertAdminTotpCredential(3, {
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: after(TEN_MINUTES),
    });
    const store = createStore();

    expect(await store.advanceStep(adminIdOf(3), 100)).toBe(false);
    expect(await store.advanceStep(adminIdOf(2), 100)).toBe(false);
    expect(await readAdminTotpCredential(3)).toMatchObject({
      lastUsedStep: null,
    });
  });
});

describe('D1AdminTotpCredentialStore.clearExpiredPending', () => {
  const now = after(TEN_MINUTES);

  test('期限ちょうどを含めて期限切れの保留だけを消し、現在の設定を残して件数を返す', async () => {
    await insertInvitedAdmin(3);
    await insertEnabledCredential(1, {
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: now,
    });
    await insertEnabledCredential(2, {
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: new Date(now.getTime() + 1),
    });
    await insertAdminTotpCredential(3, {
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: new Date(now.getTime() - 1),
    });
    const store = createStore();

    expect(await store.clearExpiredPending(now, 500)).toBe(2);

    expect(await readAdminTotpCredential(1)).toEqual({
      sealedSecret: CURRENT_SECRET,
      enabledAt: T0,
      lastUsedStep: 100,
      pendingSealedSecret: null,
      pendingExpiresAt: null,
    });
    expect(await readAdminTotpCredential(2)).toMatchObject({
      pendingSealedSecret: PENDING_SECRET,
      pendingExpiresAt: new Date(now.getTime() + 1),
    });
    expect(await readAdminTotpCredential(3)).toMatchObject({
      pendingSealedSecret: null,
      pendingExpiresAt: null,
    });
    expect(await store.clearExpiredPending(now, 500)).toBe(0);
  });

  test('期限切れの保留をlimit件までだけ消し、残りは次の呼び出しで消す', async () => {
    await insertInvitedAdmin(3);
    for (const index of [1, 2, 3]) {
      await insertAdminTotpCredential(index, {
        pendingSealedSecret: PENDING_SECRET,
        pendingExpiresAt: now,
      });
    }
    const store = createStore();

    expect(await store.clearExpiredPending(now, 2)).toBe(2);
    expect(await store.clearExpiredPending(now, 2)).toBe(1);
    expect(await store.clearExpiredPending(now, 2)).toBe(0);
  });
});
