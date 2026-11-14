import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { readIndexedProductIds } from '../../lib/workers/directory/testing/directory-entry-fixtures.ts';
import { userIdOf } from '../../lib/workers/product/testing/product-fixtures.ts';
import { DIRECTORY_TYPES } from '../application/directory/directory-types.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type {
  UserLifecycleCommitter,
  UserStateTransition,
} from '../application/identity/ports.ts';
import { AccountIndexRemovalSyncHandler } from '../infrastructure/directory/account-index-removal-sync-handler.ts';
import {
  AFTER_DECISION,
  indexedProductIdsOf,
  OTHER_OWNER_LISTED,
  OWNER,
  OWNER_FIRST_LISTED,
  OWNER_SECOND_LISTED,
  seedIndexRemovalScenario,
} from '../infrastructure/directory/testing/index-removal-fixtures.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { MODULES } from './modules.ts';

const LATER = new Date(AFTER_DECISION.getTime() + 60_000);

const ALL_INDEXED = indexedProductIdsOf([
  OWNER_FIRST_LISTED,
  OWNER_SECOND_LISTED,
  OTHER_OWNER_LISTED,
]);

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
      at: options.at ?? AFTER_DECISION,
    });
}

beforeEach(seedIndexRemovalScenario);

describe('APIサーバーのディレクトリのモジュールのユーザーの同期の処理の束縛', () => {
  test('処理単位のコンテナから、ユーザーの同期の処理を実装に解決する', () => {
    expect(
      createContainer().get<UserLifecycleSyncHandler>(
        DIRECTORY_TYPES.AccountIndexRemovalSyncHandler,
      ),
    ).toBeInstanceOf(AccountIndexRemovalSyncHandler);
  });
});

describe('停止の同期の処理の登録', () => {
  test('停止の確定と同じ一括の書き込みで、投稿者の全ての索引文書を消し、他の投稿者の索引文書は残す', async () => {
    await commit('suspend');

    await expect(readIndexedProductIds()).resolves.toEqual(
      indexedProductIdsOf([OTHER_OWNER_LISTED]),
    );
  });

  test('停止の解除では、索引文書を作り直さない', async () => {
    await commit('suspend');

    await commit('unsuspend', { expectedVersion: 1, at: LATER });

    await expect(readIndexedProductIds()).resolves.toEqual(
      indexedProductIdsOf([OTHER_OWNER_LISTED]),
    );
  });

  test('読み取った版が古い停止は確定せず、索引文書の削除も取り消される', async () => {
    await expect(
      commit('suspend', { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readIndexedProductIds()).resolves.toEqual(ALL_INDEXED);
  });
});

describe('退会の同期の処理の登録', () => {
  test('退会の確定と同じ一括の書き込みで、投稿者の全ての索引文書を消し、他の投稿者の索引文書は残す', async () => {
    await commit('withdraw');

    await expect(readIndexedProductIds()).resolves.toEqual(
      indexedProductIdsOf([OTHER_OWNER_LISTED]),
    );
  });

  test('読み取った版が古い退会は確定せず、索引文書の削除も取り消される', async () => {
    await expect(
      commit('withdraw', { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readIndexedProductIds()).resolves.toEqual(ALL_INDEXED);
  });
});
