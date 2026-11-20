import { describe, expect, test } from 'bun:test';

import type { ModerationRecordStore } from '../../../lib/core/moderation/ports.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import {
  PRODUCT_RECORD_ERASURE_BATCH_SIZE,
  ProductRecordErasureHandler,
} from './product-record-erasure-handler.ts';

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JQ0PEV000000000000000191',
  productId: '01JQ0PRD000000000000000004',
  ownerUserId: '01JQ0USR000000000000000002',
  type: 'purge_due',
  occurredAt: new Date('2026-12-20T03:00:00.000Z'),
});

interface EraseCall {
  readonly productId: string;
  readonly limit: number;
}

function unexpected(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

// プロダクトに関わる記録の削除だけを記録し、他の操作は呼ばれたら失敗させる
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
      eraseBySubjectUser: unexpected,
      eraseByProduct: (productId, limit) => {
        calls.push({ productId, limit });
        const remaining = pending.shift();
        return remaining === undefined
          ? unexpected()
          : Promise.resolve({ remaining });
      },
      eraseOccurredBefore: unexpected,
    },
    calls,
  };
}

describe('ProductRecordErasureHandler', () => {
  test('1回に消す措置の記録の上限は500件である', () => {
    expect(PRODUCT_RECORD_ERASURE_BATCH_SIZE).toBe(500);
  });

  test('プロダクトに関わる記録の削除を上限で1回呼び、残りがあれば続きを返す', async () => {
    const { store, calls } = createFakeStore([true]);

    expect(
      await new ProductRecordErasureHandler(store).handle(EVENT),
    ).toStrictEqual({ kind: 'continue' });
    expect(calls).toStrictEqual([
      { productId: EVENT.productId, limit: PRODUCT_RECORD_ERASURE_BATCH_SIZE },
    ]);
  });

  test('残りが無ければ完了を返す', async () => {
    const { store, calls } = createFakeStore([false]);

    expect(
      await new ProductRecordErasureHandler(store).handle(EVENT),
    ).toStrictEqual({ kind: 'done' });
    expect(calls).toHaveLength(1);
  });

  test('続きの呼び出しで残りが尽きた回に完了を返し、同じイベントの呼び直しでも完了を返す', async () => {
    const { store, calls } = createFakeStore([true, false, false]);
    const handler = new ProductRecordErasureHandler(store);

    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'continue' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(calls.map(({ productId }) => productId)).toStrictEqual([
      EVENT.productId,
      EVENT.productId,
      EVENT.productId,
    ]);
  });

  test('削除の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const { store } = createFakeStore([]);
    const failing: ModerationRecordStore = {
      ...store,
      eraseByProduct: () => Promise.reject(failure),
    };

    expect(
      await new ProductRecordErasureHandler(failing)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
