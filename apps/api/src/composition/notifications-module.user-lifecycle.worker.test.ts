import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { NOTIFICATIONS_PLATFORM_TYPES } from '../../lib/core/notifications/identifiers.ts';
import type { UnsubscribeTokenService } from '../../lib/core/notifications/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  after,
  recipientIdOf,
} from '../../lib/workers/notifications/testing/notification-store-fixtures.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type {
  UserLifecycleCommitter,
  UserStateTransition,
} from '../application/identity/ports.ts';
import {
  OTHER,
  readWithdrawalState,
  seedWithdrawalScenario,
  tokenOf,
  untouchedState,
  type WithdrawalScenario,
  withdrawnState,
  WITHDRAWING,
} from '../infrastructure/notifications/testing/withdrawal-fixtures.ts';
import { MODULES } from './modules.ts';

const AT = after(60_000);
const LATER = after(120_000);

let scenario: WithdrawalScenario;

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

function tokenService(): UnsubscribeTokenService {
  return createContainer().get<UnsubscribeTokenService>(
    NOTIFICATIONS_PLATFORM_TYPES.UnsubscribeTokenService,
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
      userId: recipientIdOf(WITHDRAWING),
      expectedVersion: options.expectedVersion ?? 0,
      at: options.at ?? AT,
    });
}

beforeEach(async () => {
  scenario = await seedWithdrawalScenario(tokenService());
});

describe('退会の同期の処理の登録', () => {
  test('退会の確定と同じ一括の書き込みで、利用者のトークンの種と受信設定を消し、未送信の通知を退会の理由で送らない扱いにする', async () => {
    await commit('withdraw');

    await expect(readWithdrawalState()).resolves.toEqual(withdrawnState(AT));
  });

  test('退会の確定の直後から、利用者の配信停止のトークンは照合できず、他の利用者のトークンは照合できる', async () => {
    await commit('withdraw');

    const tokens = tokenService();
    await expect(
      tokens.resolve(tokenOf(scenario, WITHDRAWING, 'match_preview')),
    ).resolves.toBeUndefined();
    await expect(
      tokens.resolve(tokenOf(scenario, OTHER, 'match_preview')),
    ).resolves.toEqual({
      userId: recipientIdOf(OTHER),
      topic: 'match_preview',
    });
  });

  test('読み取った版が古い退会は確定せず、トークンの種・受信設定・通知の変更も取り消される', async () => {
    await expect(
      commit('withdraw', { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readWithdrawalState()).resolves.toEqual(untouchedState());
    await expect(
      tokenService().resolve(tokenOf(scenario, WITHDRAWING, 'match_result')),
    ).resolves.toEqual({
      userId: recipientIdOf(WITHDRAWING),
      topic: 'match_result',
    });
  });
});

describe('停止と停止の解除', () => {
  test('停止と停止の解除では、トークンの種・受信設定・通知を変えず、トークンも照合できる', async () => {
    await commit('suspend');

    await expect(readWithdrawalState()).resolves.toEqual(untouchedState());

    await commit('unsuspend', { expectedVersion: 1, at: LATER });

    await expect(readWithdrawalState()).resolves.toEqual(untouchedState());
    await expect(
      tokenService().resolve(tokenOf(scenario, WITHDRAWING, 'match_result')),
    ).resolves.toEqual({
      userId: recipientIdOf(WITHDRAWING),
      topic: 'match_result',
    });
  });
});
