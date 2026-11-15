import { describe, expect, test } from 'bun:test';

import type { EngagementErasureStore } from '../../../lib/core/engagement/ports.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  ACCOUNT_ERASURE_BATCH_SIZE,
  AccountErasureHandler,
} from './account-erasure-handler.ts';

const NOW = new Date('2026-11-21T03:00:00.000Z');

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JD0EVT000000000000000141',
  userId: '01JD0USER00000000000000003',
  type: 'purge_due',
  occurredAt: new Date('2026-11-20T00:00:00.000Z'),
});

const clock: Clock = { now: () => NOW };

interface EraseAccountCall {
  readonly userId: string;
  readonly at: Date;
  readonly limit: number;
}

function unexpected(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

// 利用者単位の消去だけを記録し、匿名化のジョブとプロダクト単位の操作は呼ばれたら失敗させる
function createFakeStore(remainings: readonly boolean[]): {
  readonly store: EngagementErasureStore;
  readonly calls: readonly EraseAccountCall[];
} {
  const calls: EraseAccountCall[] = [];
  const pending = [...remainings];
  return {
    store: {
      anonymizeDeletedBefore: unexpected,
      countOverdue: unexpected,
      eraseAccount: (input) => {
        calls.push({ ...input });
        const remaining = pending.shift();
        return remaining === undefined
          ? unexpected()
          : Promise.resolve({ remaining });
      },
      eraseProduct: unexpected,
    },
    calls,
  };
}

describe('AccountErasureHandler', () => {
  test('1回に匿名化するコメントと消す評価の上限はそれぞれ500件である', () => {
    expect(ACCOUNT_ERASURE_BATCH_SIZE).toBe(500);
  });

  test('利用者のコメントの匿名化と評価の削除を現在の日時と上限で1回呼び、残りがあれば続きを返す', async () => {
    const { store, calls } = createFakeStore([true]);

    expect(
      await new AccountErasureHandler(store, clock).handle(EVENT),
    ).toStrictEqual({ kind: 'continue' });
    expect(calls).toStrictEqual([
      { userId: EVENT.userId, at: NOW, limit: ACCOUNT_ERASURE_BATCH_SIZE },
    ]);
  });

  test('残りが無ければ完了を返す', async () => {
    const { store, calls } = createFakeStore([false]);

    expect(
      await new AccountErasureHandler(store, clock).handle(EVENT),
    ).toStrictEqual({ kind: 'done' });
    expect(calls).toHaveLength(1);
  });

  test('続きの呼び出しで残りが尽きた回に完了を返し、同じイベントの呼び直しでも完了を返す', async () => {
    const { store, calls } = createFakeStore([true, false, false]);
    const handler = new AccountErasureHandler(store, clock);

    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'continue' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(calls.map(({ userId }) => userId)).toStrictEqual([
      EVENT.userId,
      EVENT.userId,
      EVENT.userId,
    ]);
  });

  test('消去の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const store: EngagementErasureStore = {
      anonymizeDeletedBefore: unexpected,
      countOverdue: unexpected,
      eraseAccount: () => Promise.reject(failure),
      eraseProduct: unexpected,
    };

    expect(
      await new AccountErasureHandler(store, clock)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
