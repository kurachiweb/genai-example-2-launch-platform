import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { userIdOf } from '../../lib/workers/product/testing/product-fixtures.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type {
  UserLifecycleCommitter,
  UserStateTransition,
} from '../application/identity/ports.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import type { UserLifecycleSyncHandler } from '../infrastructure/identity/user-lifecycle-sync-handler.ts';
import { AccountMatchClosureSyncHandler } from '../infrastructure/match/account-match-closure-sync-handler.ts';
import {
  expectedScenario,
  LIVE_VOTER_UPVOTE,
  ownerAClosure,
  PREVIOUS_DAY_VOTER_UPVOTE,
  readScenario,
  seedClosureScenario,
  voterLiveUpvoteRemoved,
} from '../infrastructure/match/testing/closure-fixtures.ts';
import {
  DURING_MATCH,
  ENTRY_A,
  OWNER_A,
  VOTER,
} from '../infrastructure/match/testing/upvote-store-fixtures.ts';
import { MODULES } from './modules.ts';

const LATER = new Date(DURING_MATCH.getTime() + 60_000);

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
  userIndex: number,
  options: { readonly expectedVersion?: number; readonly at?: Date } = {},
): Promise<void> {
  await createContainer()
    .get<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
    .commit({
      kind,
      userId: userIdOf(userIndex),
      expectedVersion: options.expectedVersion ?? 0,
      at: options.at ?? DURING_MATCH,
    });
}

beforeEach(seedClosureScenario);

describe('APIサーバーのマッチのモジュールの同期の処理の束縛', () => {
  test('処理単位のコンテナから、ユーザーの同期の処理を実装に解決する', () => {
    expect(
      createContainer().get<UserLifecycleSyncHandler>(
        MATCH_TYPES.AccountMatchClosureSyncHandler,
      ),
    ).toBeInstanceOf(AccountMatchClosureSyncHandler);
  });
});

describe('停止の同期の処理の登録', () => {
  test('停止の確定と同じ一括の書き込みで、停止した利用者のマッチ中のマッチへのUpvoteだけを論理削除し、その側の集計値を求め直す', async () => {
    await commit('suspend', VOTER);

    await expect(readScenario()).resolves.toEqual(
      expectedScenario({
        entries: voterLiveUpvoteRemoved(DURING_MATCH),
        upvotes: { [LIVE_VOTER_UPVOTE]: DURING_MATCH },
      }),
    );
  });

  test('停止の確定と同じ一括の書き込みで、投稿者のマッチ中のマッチを即時に終了し、開始前のマッチの側に該当を記録する', async () => {
    await commit('suspend', OWNER_A);

    await expect(readScenario()).resolves.toEqual(
      expectedScenario(ownerAClosure(DURING_MATCH)),
    );
  });

  test('停止の解除では、論理削除したUpvote・即時の終了・該当の記録を元に戻さない', async () => {
    await commit('suspend', VOTER);
    await commit('suspend', OWNER_A);

    await commit('unsuspend', VOTER, { expectedVersion: 1, at: LATER });
    await commit('unsuspend', OWNER_A, { expectedVersion: 1, at: LATER });

    const closure = ownerAClosure(DURING_MATCH);
    const recomputed = voterLiveUpvoteRemoved(DURING_MATCH);
    await expect(readScenario()).resolves.toEqual(
      expectedScenario({
        matches: closure.matches,
        entries: {
          ...closure.entries,
          [ENTRY_A]: { ...recomputed[ENTRY_A], ...closure.entries[ENTRY_A] },
        },
        upvotes: { [LIVE_VOTER_UPVOTE]: DURING_MATCH },
      }),
    );
  });

  test('読み取った版が古い停止は確定せず、マッチの即時の終了とUpvoteの論理削除も取り消される', async () => {
    await expect(
      commit('suspend', OWNER_A, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });
    await expect(
      commit('suspend', VOTER, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readScenario()).resolves.toEqual(expectedScenario({}));
  });
});

describe('退会の同期の処理の登録', () => {
  test('退会の確定と同じ一括の書き込みで、退会した利用者の全てのUpvoteを論理削除し、確定したマッチの確定値を変えずにマッチ中のマッチの側だけを求め直す', async () => {
    await commit('withdraw', VOTER);

    await expect(readScenario()).resolves.toEqual(
      expectedScenario({
        entries: voterLiveUpvoteRemoved(DURING_MATCH),
        upvotes: {
          [LIVE_VOTER_UPVOTE]: DURING_MATCH,
          [PREVIOUS_DAY_VOTER_UPVOTE]: DURING_MATCH,
        },
      }),
    );
  });

  test('退会の確定と同じ一括の書き込みで、投稿者のマッチ中のマッチを即時に終了し、開始前のマッチの側に該当を記録する', async () => {
    await commit('withdraw', OWNER_A);

    await expect(readScenario()).resolves.toEqual(
      expectedScenario(ownerAClosure(DURING_MATCH)),
    );
  });

  test('読み取った版が古い退会は確定せず、マッチの即時の終了とUpvoteの論理削除も取り消される', async () => {
    await expect(
      commit('withdraw', OWNER_A, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });
    await expect(
      commit('withdraw', VOTER, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    await expect(readScenario()).resolves.toEqual(expectedScenario({}));
  });
});
