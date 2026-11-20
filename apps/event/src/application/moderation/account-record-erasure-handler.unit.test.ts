import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { ModerationRecordStore } from '../../../lib/core/moderation/ports.ts';
import {
  ACCOUNT_RECORD_ERASURE_BATCH_SIZE,
  AccountRecordErasureHandler,
} from './account-record-erasure-handler.ts';

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JQ0EVT000000000000000191',
  userId: '01JQ0USR000000000000000003',
  type: 'purge_due',
  occurredAt: new Date('2026-11-20T00:00:00.000Z'),
});

interface EraseCall {
  readonly userId: string;
  readonly limit: number;
}

function unexpected(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

// 利用者に関わる記録の削除だけを記録し、他の操作は呼ばれたら失敗させる
function createFakeStore(remainings: readonly boolean[]): {
  readonly store: ModerationRecordStore;
  readonly calls: readonly EraseCall[];
} {
  const calls: EraseCall[] = [];
  const pending = [...remainings];
  return {
    store: {
      find: unexpected,
      latestFor: unexpected,
      listPendingNotices: unexpected,
      markNotice: unexpected,
      eraseBySubjectUser: (userId, limit) => {
        calls.push({ userId, limit });
        const remaining = pending.shift();
        return remaining === undefined
          ? unexpected()
          : Promise.resolve({ remaining });
      },
      eraseByProduct: unexpected,
      eraseOccurredBefore: unexpected,
    },
    calls,
  };
}

describe('AccountRecordErasureHandler', () => {
  test('1回に消す措置の記録の上限は500件である', () => {
    expect(ACCOUNT_RECORD_ERASURE_BATCH_SIZE).toBe(500);
  });

  test('利用者に関わる記録の削除を上限で1回呼び、残りがあれば続きを返す', async () => {
    const { store, calls } = createFakeStore([true]);

    expect(
      await new AccountRecordErasureHandler(store).handle(EVENT),
    ).toStrictEqual({ kind: 'continue' });
    expect(calls).toStrictEqual([
      { userId: EVENT.userId, limit: ACCOUNT_RECORD_ERASURE_BATCH_SIZE },
    ]);
  });

  test('残りが無ければ完了を返す', async () => {
    const { store, calls } = createFakeStore([false]);

    expect(
      await new AccountRecordErasureHandler(store).handle(EVENT),
    ).toStrictEqual({ kind: 'done' });
    expect(calls).toHaveLength(1);
  });

  test('続きの呼び出しで残りが尽きた回に完了を返し、同じイベントの呼び直しでも完了を返す', async () => {
    const { store, calls } = createFakeStore([true, false, false]);
    const handler = new AccountRecordErasureHandler(store);

    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'continue' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(calls.map(({ userId }) => userId)).toStrictEqual([
      EVENT.userId,
      EVENT.userId,
      EVENT.userId,
    ]);
  });

  test('削除の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const { store } = createFakeStore([]);
    const failing: ModerationRecordStore = {
      ...store,
      eraseBySubjectUser: () => Promise.reject(failure),
    };

    expect(
      await new AccountRecordErasureHandler(failing)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
