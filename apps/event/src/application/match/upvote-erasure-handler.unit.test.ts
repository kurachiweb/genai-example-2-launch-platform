import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { MatchPurgeStore } from './ports.ts';
import {
  UPVOTE_ERASURE_BATCH_SIZE,
  UpvoteErasureHandler,
} from './upvote-erasure-handler.ts';

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JD0EVT000000000000000071',
  userId: '01JD0USER00000000000000003',
  type: 'purge_due',
  occurredAt: new Date('2026-11-20T00:00:00.000Z'),
});

interface StoreCall {
  readonly operation: 'deleteUpvotesBatch' | 'clearOwner';
  readonly userId: string;
  readonly limit?: number;
}

function unexpected(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

// Upvoteの削除と投稿者の紐付けの解除だけを記録し、プロダクトの側の操作は呼ばれたら失敗させる
function createFakeStore(deletedCounts: readonly number[]): {
  readonly store: MatchPurgeStore;
  readonly calls: readonly StoreCall[];
} {
  const calls: StoreCall[] = [];
  const pending = [...deletedCounts];
  return {
    store: {
      deleteUpvotesBatch: (userId, limit) => {
        calls.push({ operation: 'deleteUpvotesBatch', userId, limit });
        const next = pending.shift();
        return next === undefined ? unexpected() : Promise.resolve(next);
      },
      clearOwner: (userId) => {
        calls.push({ operation: 'clearOwner', userId });
        return Promise.resolve();
      },
      unlinkProduct: unexpected,
    },
    calls,
  };
}

describe('UpvoteErasureHandler', () => {
  test('1回に消すUpvoteの上限は1,000件である', () => {
    expect(UPVOTE_ERASURE_BATCH_SIZE).toBe(1000);
  });

  test('Upvoteの削除が上限の件数ちょうどなら、投稿者の紐付けを外さずに続きを返す', async () => {
    const { store, calls } = createFakeStore([UPVOTE_ERASURE_BATCH_SIZE]);

    expect(await new UpvoteErasureHandler(store).handle(EVENT)).toStrictEqual({
      kind: 'continue',
    });
    expect(calls).toStrictEqual([
      {
        operation: 'deleteUpvotesBatch',
        userId: EVENT.userId,
        limit: UPVOTE_ERASURE_BATCH_SIZE,
      },
    ]);
  });

  test.each([0, 1, UPVOTE_ERASURE_BATCH_SIZE - 1])(
    'Upvoteの削除が上限の件数未満(%i件)なら、投稿者の紐付けの残りを外して完了を返す',
    async (deleted) => {
      const { store, calls } = createFakeStore([deleted]);

      expect(await new UpvoteErasureHandler(store).handle(EVENT)).toStrictEqual(
        { kind: 'done' },
      );
      expect(calls).toStrictEqual([
        {
          operation: 'deleteUpvotesBatch',
          userId: EVENT.userId,
          limit: UPVOTE_ERASURE_BATCH_SIZE,
        },
        { operation: 'clearOwner', userId: EVENT.userId },
      ]);
    },
  );

  test('続きの呼び出しでUpvoteが尽きた回に、投稿者の紐付けを1回だけ外す', async () => {
    const { store, calls } = createFakeStore([UPVOTE_ERASURE_BATCH_SIZE, 0]);
    const handler = new UpvoteErasureHandler(store);

    expect(await handler.handle(EVENT)).toStrictEqual({
      kind: 'continue',
    });
    expect(await handler.handle(EVENT)).toStrictEqual({
      kind: 'done',
    });
    expect(calls.map(({ operation }) => operation)).toStrictEqual([
      'deleteUpvotesBatch',
      'deleteUpvotesBatch',
      'clearOwner',
    ]);
  });

  test('Upvoteの削除の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const store: MatchPurgeStore = {
      deleteUpvotesBatch: () => Promise.reject(failure),
      clearOwner: unexpected,
      unlinkProduct: unexpected,
    };

    expect(
      await new UpvoteErasureHandler(store)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });

  test('投稿者の紐付けの解除の失敗は捕まえずに投げる', async () => {
    const failure = new Error('D1の障害');
    const store: MatchPurgeStore = {
      deleteUpvotesBatch: () => Promise.resolve(0),
      clearOwner: () => Promise.reject(failure),
      unlinkProduct: unexpected,
    };

    expect(
      await new UpvoteErasureHandler(store)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
