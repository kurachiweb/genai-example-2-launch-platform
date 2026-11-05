import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import {
  MEMBER_INQUIRY_PURGE_BATCH_SIZE,
  MemberInquiryPurgeHandler,
} from './member-inquiry-purge-handler.ts';
import type {
  MemberInquiryPurgeBatchResult,
  MemberInquiryPurgeStore,
} from './ports.ts';

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JC0EVT000000000000000010',
  userId: '01JC0USER00000000000000001',
  type: 'purge_due',
  occurredAt: new Date('2026-11-05T00:00:00.000Z'),
});

interface PurgeCall {
  readonly userId: string;
  readonly limit: number;
}

function createFakeStore(results: readonly MemberInquiryPurgeBatchResult[]): {
  readonly store: MemberInquiryPurgeStore;
  readonly calls: readonly PurgeCall[];
} {
  const calls: PurgeCall[] = [];
  const pending = [...results];
  return {
    store: {
      purgeBatch: (userId, limit) => {
        calls.push({ userId, limit });
        const next = pending.shift();
        return next === undefined
          ? Promise.reject(new Error('想定外の呼び出し'))
          : Promise.resolve(next);
      },
    },
    calls,
  };
}

describe('MemberInquiryPurgeHandler', () => {
  test('1回の上限の件数は100件である', () => {
    expect(MEMBER_INQUIRY_PURGE_BATCH_SIZE).toBe(100);
  });

  test('イベントの利用者の問い合わせを上限の件数だけ消し、残りがあれば続きありを返す', async () => {
    const { store, calls } = createFakeStore([{ hasMore: true }]);

    expect(
      await new MemberInquiryPurgeHandler(store).handle(EVENT),
    ).toStrictEqual({ kind: 'continue' });
    expect(calls).toStrictEqual([
      { userId: EVENT.userId, limit: MEMBER_INQUIRY_PURGE_BATCH_SIZE },
    ]);
  });

  test('残りが無ければ完了を返す', async () => {
    const { store } = createFakeStore([{ hasMore: false }]);

    expect(
      await new MemberInquiryPurgeHandler(store).handle(EVENT),
    ).toStrictEqual({ kind: 'done' });
  });

  test('削除の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const store: MemberInquiryPurgeStore = {
      purgeBatch: () => Promise.reject(failure),
    };

    expect(
      await new MemberInquiryPurgeHandler(store)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
