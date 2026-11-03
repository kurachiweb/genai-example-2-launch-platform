import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, test } from 'vitest';

import { createDatabase } from '../../../db/client.ts';
import { createBatchRecordingD1 } from '../../../test/support/batch-recording-d1.ts';
import type { AdminRecoveryCodeStore } from '../../application/admin/ports.ts';
import { D1AdminRecoveryCodeStore } from './d1-admin-recovery-code-store.ts';
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
  T0,
} from './testing/admin-store-fixtures.ts';

const MAX_BOUND_PARAMETERS = 100;

function createStore(): AdminRecoveryCodeStore {
  return new D1AdminRecoveryCodeStore(db);
}

function recoveryHashesOf(label: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `recovery-${label}-${String(index).padStart(2, '0')}`,
  );
}

async function insertEnabledCredential(adminIndex: number): Promise<void> {
  await insertAdminTotpCredential(adminIndex, {
    sealedSecret: 'sealed-secret',
    enabledAt: T0,
    lastUsedStep: 100,
  });
}

beforeEach(async () => {
  await clearAdminTables();
  await insertAdmin(1);
  await insertAdmin(2);
  await insertAdminRecoveryHashes(1, recoveryHashesOf('one', 3));
  await insertAdminRecoveryHashes(2, recoveryHashesOf('two', 1));
});

describe('D1AdminRecoveryCodeStoreの消費と数え上げ', () => {
  test('consumeは管理者の一致したリカバリコードを削除し、同じコードの2回目を拒否する', async () => {
    const [target = ''] = recoveryHashesOf('one', 1);
    const store = createStore();

    expect(await store.consume(adminIdOf(1), target)).toBe(true);
    expect(await store.consume(adminIdOf(1), target)).toBe(false);

    expect(await readAdminRecoveryHashes(1)).toEqual(
      recoveryHashesOf('one', 3).slice(1),
    );
  });

  test('consumeは他の管理者のリカバリコードと無いコードを拒否し、削除しない', async () => {
    const [otherAdminCode = ''] = recoveryHashesOf('two', 1);
    const store = createStore();

    expect(await store.consume(adminIdOf(1), otherAdminCode)).toBe(false);
    expect(await store.consume(adminIdOf(1), 'recovery-missing')).toBe(false);

    expect(await readAdminRecoveryHashes(1)).toHaveLength(3);
    expect(await readAdminRecoveryHashes(2)).toEqual([otherAdminCode]);
  });

  test('countは管理者の未使用のリカバリコードの数を返し、無い管理者には0を返す', async () => {
    await insertAdmin(3);
    const store = createStore();

    expect(await store.count(adminIdOf(1))).toBe(3);
    expect(await store.count(adminIdOf(2))).toBe(1);
    expect(await store.count(adminIdOf(3))).toBe(0);
  });
});

describe('D1AdminRecoveryCodeStore.replaceAllRevokingSessions', () => {
  beforeEach(async () => {
    await insertAdminSessions(1, 2);
    await insertAdminSessions(2, 1);
  });

  test('未使用のリカバリコードの置き換えと全セッションの削除を1つの一括の書き込みで行い、他の管理者のコードとセッションを残す', async () => {
    await insertEnabledCredential(1);
    const recording = createBatchRecordingD1(env.DB);

    expect(
      await new D1AdminRecoveryCodeStore(
        createDatabase(recording.d1),
      ).replaceAllRevokingSessions(adminIdOf(1), recoveryHashesOf('new', 10)),
    ).toBe('replaced');

    expect(recording.batches).toHaveLength(1);
    expect(recording.statementsOutsideBatches()).toEqual([]);
    for (const query of recording.batches.flat()) {
      expect(placeholderCountOf(query)).toBeLessThanOrEqual(
        MAX_BOUND_PARAMETERS,
      );
    }
    expect(await readAdminRecoveryHashes(1)).toEqual(
      recoveryHashesOf('new', 10),
    );
    expect(await readAdminSessionIdsOf(1)).toEqual([]);
    expect(await readAdminRecoveryHashes(2)).toEqual(
      recoveryHashesOf('two', 1),
    );
    expect(await readAdminSessionIdsOf(2)).toEqual(adminSessionIdsOf(2, 1));
  });

  test.each([
    ['資格情報の無い管理者', false],
    ['有効な設定の無い招待の途中の保留', true],
  ] as const)(
    '%sは置き換えずにnot-enabledを返し、残っていたコードとセッションを消さない',
    async (_label, hasPending) => {
      if (hasPending) {
        await insertAdminTotpCredential(1, {
          pendingSealedSecret: 'sealed-secret-pending',
          pendingExpiresAt: after(600_000),
        });
      }

      expect(
        await createStore().replaceAllRevokingSessions(
          adminIdOf(1),
          recoveryHashesOf('new', 10),
        ),
      ).toBe('not-enabled');

      expect(await readAdminRecoveryHashes(1)).toEqual(
        recoveryHashesOf('one', 3),
      );
      expect(await readAdminSessionIdsOf(1)).toEqual(adminSessionIdsOf(1, 2));
    },
  );

  test('招待中の管理者には置き換えずにnot-enabledを返す', async () => {
    await insertInvitedAdmin(3);

    expect(
      await createStore().replaceAllRevokingSessions(
        adminIdOf(3),
        recoveryHashesOf('new', 10),
      ),
    ).toBe('not-enabled');

    expect(await readAdminRecoveryHashes(3)).toEqual([]);
  });
});
