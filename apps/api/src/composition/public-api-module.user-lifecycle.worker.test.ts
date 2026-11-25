import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { apiKeys } from '../../db/schema/public-api/api-keys.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  after,
  db,
  insertUser,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  apiKeyIdOf,
  clearApiKeyTables,
  insertApiKey,
} from '../../lib/workers/public-api/testing/api-key-fixtures.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type {
  UserLifecycleCommitter,
  UserStateTransition,
} from '../application/identity/ports.ts';
import { PUBLIC_API_TYPES } from '../application/public-api/public-api-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { ApiKeyErasureSyncHandler } from '../infrastructure/public-api/api-key-erasure-sync-handler.ts';
import { MODULES } from './modules.ts';
import { USER_LIFECYCLE_SYNC_HANDLERS } from './user-lifecycle-sync-handlers.ts';

const OWNER = 1;

const OTHER = 2;

const AT = after(60_000);

const LATER = after(120_000);

const OWNER_KEYS = [1, 2, 3];

const OTHER_KEYS = [4, 5];

const ALL_KEYS = [...OWNER_KEYS, ...OTHER_KEYS];

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

async function commit(
  kind: UserStateTransition['kind'],
  options: { readonly expectedVersion?: number; readonly at?: Date } = {},
): Promise<void> {
  await createContainer()
    .get<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
    .commit({
      kind,
      userId: userIdOf(OWNER),
      expectedVersion: options.expectedVersion ?? 0,
      at: options.at ?? AT,
    });
}

async function readKeyIds(): Promise<string[]> {
  const rows = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .orderBy(asc(apiKeys.id));
  return rows.map(({ id }) => id);
}

function keyIdsOf(indexes: readonly number[]): string[] {
  return indexes.map(apiKeyIdOf);
}

beforeEach(async () => {
  await clearApiKeyTables();
  await insertUser(OWNER);
  await insertUser(OTHER);
  for (const index of OWNER_KEYS) {
    await insertApiKey(index, OWNER);
  }
  for (const index of OTHER_KEYS) {
    await insertApiKey(index, OTHER);
  }
});

describe('APIサーバーの公開APIのモジュールのユーザーの同期の処理の束縛', () => {
  test('退会の同期の処理を、退会だけを対象にユーザーの同期の処理の登録口に1つ登録する', () => {
    expect(
      USER_LIFECYCLE_SYNC_HANDLERS.filter(
        ({ name, handler }) =>
          name === 'public-api.api-key-erasure' ||
          handler === PUBLIC_API_TYPES.ApiKeyErasureSyncHandler,
      ),
    ).toStrictEqual([
      {
        name: 'public-api.api-key-erasure',
        events: ['withdrawn'],
        handler: PUBLIC_API_TYPES.ApiKeyErasureSyncHandler,
      },
    ]);
  });

  test('処理単位のコンテナから、退会の同期の処理を実装に解決する', () => {
    expect(
      createContainer().get<UserLifecycleSyncHandler>(
        PUBLIC_API_TYPES.ApiKeyErasureSyncHandler,
      ),
    ).toBeInstanceOf(ApiKeyErasureSyncHandler);
  });
});

describe('退会の同期の処理の登録', () => {
  test('退会の確定と同じ一括の書き込みで、退会した利用者のキーを全て消し、他の利用者のキーは残す', async () => {
    await commit('withdraw');

    await expect(readKeyIds()).resolves.toEqual(keyIdsOf(OTHER_KEYS));
  });

  test('読み取った版が古い退会は確定せず、キーの削除も取り消される', async () => {
    await expect(
      commit('withdraw', { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readKeyIds()).resolves.toEqual(keyIdsOf(ALL_KEYS));
  });
});

describe('停止と停止の解除', () => {
  test('停止と停止の解除では、キーを消さない', async () => {
    await commit('suspend');

    await expect(readKeyIds()).resolves.toEqual(keyIdsOf(ALL_KEYS));

    await commit('unsuspend', { expectedVersion: 1, at: LATER });

    await expect(readKeyIds()).resolves.toEqual(keyIdsOf(ALL_KEYS));
  });

  test('停止中の利用者の退会でも、キーを全て消す', async () => {
    await commit('suspend');

    await commit('withdraw', { expectedVersion: 1, at: LATER });

    await expect(readKeyIds()).resolves.toEqual(keyIdsOf(OTHER_KEYS));
  });
});
