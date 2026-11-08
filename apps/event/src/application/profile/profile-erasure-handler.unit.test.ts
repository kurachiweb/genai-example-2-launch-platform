import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { ProfilePurgeStore } from './ports.ts';
import {
  FOLLOW_ERASURE_BATCH_SIZE,
  ProfileErasureHandler,
} from './profile-erasure-handler.ts';

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JC0EVT000000000000000061',
  userId: '01JC0USER00000000000000001',
  type: 'purge_due',
  occurredAt: new Date('2026-11-20T00:00:00.000Z'),
});

interface StoreCall {
  readonly operation: 'deleteFollowsBatch' | 'deleteProfileRows';
  readonly userId: string;
  readonly limit?: number;
}

function createFakeStore(deletedCounts: readonly number[]): {
  readonly store: ProfilePurgeStore;
  readonly calls: readonly StoreCall[];
} {
  const calls: StoreCall[] = [];
  const pending = [...deletedCounts];
  return {
    store: {
      deleteFollowsBatch: (userId, limit) => {
        calls.push({ operation: 'deleteFollowsBatch', userId, limit });
        const next = pending.shift();
        return next === undefined
          ? Promise.reject(new Error('想定外の呼び出し'))
          : Promise.resolve(next);
      },
      deleteProfileRows: (userId) => {
        calls.push({ operation: 'deleteProfileRows', userId });
        return Promise.resolve();
      },
    },
    calls,
  };
}

describe('ProfileErasureHandler', () => {
  test('1回に消すフォローの上限は1,000件である', () => {
    expect(FOLLOW_ERASURE_BATCH_SIZE).toBe(1000);
  });

  test('フォローの削除が上限の件数ちょうどなら、プロフィールの行を消さずに続きを返す', async () => {
    const { store, calls } = createFakeStore([FOLLOW_ERASURE_BATCH_SIZE]);

    expect(await new ProfileErasureHandler(store).handle(EVENT)).toStrictEqual({
      kind: 'continue',
    });
    expect(calls).toStrictEqual([
      {
        operation: 'deleteFollowsBatch',
        userId: EVENT.userId,
        limit: FOLLOW_ERASURE_BATCH_SIZE,
      },
    ]);
  });

  test.each([0, 1, FOLLOW_ERASURE_BATCH_SIZE - 1])(
    'フォローの削除が上限の件数未満(%i件)なら、プロフィールの行を消して完了を返す',
    async (deleted) => {
      const { store, calls } = createFakeStore([deleted]);

      expect(
        await new ProfileErasureHandler(store).handle(EVENT),
      ).toStrictEqual({ kind: 'done' });
      expect(calls.map(({ operation }) => operation)).toStrictEqual([
        'deleteFollowsBatch',
        'deleteProfileRows',
      ]);
      expect(calls[1]).toStrictEqual({
        operation: 'deleteProfileRows',
        userId: EVENT.userId,
      });
    },
  );

  test('続きの呼び出しでフォローが尽きた回に、プロフィールの行を1回だけ消す', async () => {
    const { store, calls } = createFakeStore([FOLLOW_ERASURE_BATCH_SIZE, 1]);
    const handler = new ProfileErasureHandler(store);

    await handler.handle(EVENT);
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(calls.map(({ operation }) => operation)).toStrictEqual([
      'deleteFollowsBatch',
      'deleteFollowsBatch',
      'deleteProfileRows',
    ]);
  });

  test('フォローの削除の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const store: ProfilePurgeStore = {
      deleteFollowsBatch: () => Promise.reject(failure),
      deleteProfileRows: () => Promise.resolve(),
    };

    expect(
      await new ProfileErasureHandler(store)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });

  test('プロフィールの行の削除の失敗は捕まえずに投げる', async () => {
    const failure = new Error('D1の障害');
    const store: ProfilePurgeStore = {
      deleteFollowsBatch: () => Promise.resolve(0),
      deleteProfileRows: () => Promise.reject(failure),
    };

    expect(
      await new ProfileErasureHandler(store)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
