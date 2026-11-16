import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  after,
  userIdOf,
} from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { ENGAGEMENT_TYPES } from '../application/engagement/engagement-types.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type {
  UserLifecycleCommitter,
  UserStateTransition,
} from '../application/identity/ports.ts';
import { EngagementWithdrawalSyncHandler } from '../infrastructure/engagement/engagement-withdrawal-sync-handler.ts';
import {
  readWithdrawalState,
  seedWithdrawalScenario,
  untouchedState,
  withdrawnState,
  WITHDRAWING,
} from '../infrastructure/engagement/testing/withdrawal-fixtures.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { MODULES } from './modules.ts';

const AT = after(60_000);
const LATER = after(120_000);

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
      userId: userIdOf(WITHDRAWING),
      expectedVersion: options.expectedVersion ?? 0,
      at: options.at ?? AT,
    });
}

beforeEach(seedWithdrawalScenario);

describe('APIサーバーのエンゲージメントのモジュールのユーザーの同期の処理の束縛', () => {
  test('処理単位のコンテナから、退会の同期の処理を実装に解決する', () => {
    expect(
      createContainer().get<UserLifecycleSyncHandler>(
        ENGAGEMENT_TYPES.EngagementWithdrawalSyncHandler,
      ),
    ).toBeInstanceOf(EngagementWithdrawalSyncHandler);
  });
});

describe('退会の同期の処理の登録', () => {
  test('退会の確定と同じ一括の書き込みで、退会した利用者のコメントと評価を退会の日時で論理削除し、他の利用者の行と論理削除済みのコメントの日時は変えない', async () => {
    await commit('withdraw');

    await expect(readWithdrawalState()).resolves.toEqual(withdrawnState(AT));
  });

  test('読み取った版が古い退会は確定せず、コメントと評価の論理削除も取り消される', async () => {
    await expect(
      commit('withdraw', { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readWithdrawalState()).resolves.toEqual(untouchedState());
  });
});

describe('停止と停止の解除', () => {
  test('停止と停止の解除では、コメントと評価を変えない', async () => {
    await commit('suspend');

    await expect(readWithdrawalState()).resolves.toEqual(untouchedState());

    await commit('unsuspend', { expectedVersion: 1, at: LATER });

    await expect(readWithdrawalState()).resolves.toEqual(untouchedState());
  });
});
