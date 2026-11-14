import { describe, expect, test } from 'bun:test';

import type { DirectoryEntryStore } from '../../../lib/core/directory/ports.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import { EntryErasureHandler } from './entry-erasure-handler.ts';

const PRODUCT_ID = '01JD0PROD00000000000000004';

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JD0PEVT00000000000000081',
  productId: PRODUCT_ID,
  ownerUserId: '01JD0USER00000000000000002',
  type: 'purge_due',
  occurredAt: new Date('2026-12-20T03:00:00.000Z'),
});

function notUsed(): never {
  throw new Error('物理削除の処理はこの操作を使わない');
}

function createFakeStore(failure?: Error): {
  readonly store: DirectoryEntryStore;
  readonly erased: readonly string[];
} {
  const erased: string[] = [];
  return {
    store: {
      record: notUsed,
      exists: notUsed,
      listProductIdsByOwner: notUsed,
      erase: (productId) => {
        erased.push(productId);
        return failure === undefined
          ? Promise.resolve()
          : Promise.reject(failure);
      },
    },
    erased,
  };
}

describe('プロダクトの物理削除による掲載の記録の削除の処理', () => {
  test('プロダクトの記録と索引文書を消して完了する', async () => {
    const { store, erased } = createFakeStore();

    const outcome = await new EntryErasureHandler(store).handle(EVENT);

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(erased).toStrictEqual([PRODUCT_ID]);
  });

  test('同じイベントで2回呼んでも、同じ削除を繰り返して完了する', async () => {
    const { store, erased } = createFakeStore();
    const handler = new EntryErasureHandler(store);

    await handler.handle(EVENT);
    const outcome = await handler.handle(EVENT);

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(erased).toStrictEqual([PRODUCT_ID, PRODUCT_ID]);
  });

  test('削除の失敗は捕まえずに投げる', async () => {
    const error = new Error('D1 unavailable');
    const { store } = createFakeStore(error);

    const caught = await new EntryErasureHandler(store)
      .handle(EVENT)
      .catch((thrown: unknown) => thrown);

    expect(caught).toBe(error);
  });
});
