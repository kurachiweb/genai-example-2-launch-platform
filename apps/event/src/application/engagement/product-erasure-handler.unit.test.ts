import { describe, expect, test } from 'bun:test';

import type { EngagementErasureStore } from '../../../lib/core/engagement/ports.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import {
  PRODUCT_ERASURE_BATCH_SIZE,
  ProductErasureHandler,
} from './product-erasure-handler.ts';

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JD0PEVT00000000000000141',
  productId: '01JD0PR0D00000000000000004',
  ownerUserId: '01JD0USER00000000000000002',
  type: 'purge_due',
  occurredAt: new Date('2026-12-20T03:00:00.000Z'),
});

interface EraseProductCall {
  readonly productId: string;
  readonly limit: number;
}

function unexpected(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

// プロダクト単位の消去だけを記録し、匿名化のジョブと利用者単位の操作は呼ばれたら失敗させる
function createFakeStore(remainings: readonly boolean[]): {
  readonly store: EngagementErasureStore;
  readonly calls: readonly EraseProductCall[];
} {
  const calls: EraseProductCall[] = [];
  const pending = [...remainings];
  return {
    store: {
      anonymizeDeletedBefore: unexpected,
      countOverdue: unexpected,
      eraseAccount: unexpected,
      eraseProduct: (input) => {
        calls.push({ ...input });
        const remaining = pending.shift();
        return remaining === undefined
          ? unexpected()
          : Promise.resolve({ remaining });
      },
    },
    calls,
  };
}

describe('ProductErasureHandler', () => {
  test('1回に消すコメントと評価の上限はそれぞれ500件である', () => {
    expect(PRODUCT_ERASURE_BATCH_SIZE).toBe(500);
  });

  test('プロダクトの評価とコメントの削除を上限で1回呼び、残りがあれば続きを返す', async () => {
    const { store, calls } = createFakeStore([true]);

    expect(await new ProductErasureHandler(store).handle(EVENT)).toStrictEqual({
      kind: 'continue',
    });
    expect(calls).toStrictEqual([
      { productId: EVENT.productId, limit: PRODUCT_ERASURE_BATCH_SIZE },
    ]);
  });

  test('残りが無ければ完了を返す', async () => {
    const { store, calls } = createFakeStore([false]);

    expect(await new ProductErasureHandler(store).handle(EVENT)).toStrictEqual({
      kind: 'done',
    });
    expect(calls).toHaveLength(1);
  });

  test('続きの呼び出しで残りが尽きた回に完了を返し、同じイベントの呼び直しでも完了を返す', async () => {
    const { store, calls } = createFakeStore([true, false, false]);
    const handler = new ProductErasureHandler(store);

    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'continue' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(calls.map(({ productId }) => productId)).toStrictEqual([
      EVENT.productId,
      EVENT.productId,
      EVENT.productId,
    ]);
  });

  test('消去の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const store: EngagementErasureStore = {
      anonymizeDeletedBefore: unexpected,
      countOverdue: unexpected,
      eraseAccount: unexpected,
      eraseProduct: () => Promise.reject(failure),
    };

    expect(
      await new ProductErasureHandler(store)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
