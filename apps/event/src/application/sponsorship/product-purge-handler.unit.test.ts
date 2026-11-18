import { describe, expect, test } from 'bun:test';

import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { SponsorshipPurgeStore } from './ports.ts';
import { ProductPurgeHandler } from './product-purge-handler.ts';

const PRODUCT_ID = '01JD0PR0D00000000000000001';

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JD0PEVT00000000000000001',
  productId: PRODUCT_ID,
  ownerUserId: '01JD0USER00000000000000001',
  type: 'purge_due',
  occurredAt: new Date('2027-04-10T09:00:00.000Z'),
});

interface Harness {
  readonly handler: ProductPurgeHandler;
  readonly purgedProducts: string[];
  readonly remaining: Set<string>;
}

// 偽のポートは申込の行をプロダクトのIDの集合で表し、消した後の呼び出しでは何も消さない
function createHarness(failure?: Error): Harness {
  const purgedProducts: string[] = [];
  const remaining = new Set([PRODUCT_ID, '01JD0PR0D00000000000000002']);
  const store: SponsorshipPurgeStore = {
    purgeByUser: () => {
      throw new Error('プロダクトの物理削除の処理は利用者の削除を使わない');
    },
    purgeByProduct: (productId) => {
      purgedProducts.push(productId);
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      remaining.delete(productId);
      return Promise.resolve();
    },
  };
  return { handler: new ProductPurgeHandler(store), purgedProducts, remaining };
}

describe('ProductPurgeHandler', () => {
  test('物理削除の時期に、そのプロダクトの申込と表示停止の区間の削除を依頼して完了を返す', async () => {
    const { handler, purgedProducts, remaining } = createHarness();

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(purgedProducts).toEqual([PRODUCT_ID]);
    expect([...remaining]).toEqual(['01JD0PR0D00000000000000002']);
  });

  test('同じイベントを2回処理しても、2回目も同じプロダクトの削除を依頼して完了を返し、結果が変わらない', async () => {
    const { handler, purgedProducts, remaining } = createHarness();

    const first = await handler.handle(EVENT);
    const afterFirst = [...remaining];
    const second = await handler.handle(EVENT);

    expect(first).toEqual({ kind: 'done' });
    expect(second).toEqual({ kind: 'done' });
    expect(purgedProducts).toEqual([PRODUCT_ID, PRODUCT_ID]);
    expect([...remaining]).toEqual(afterFirst);
  });

  test('削除の失敗はそのまま投げ、イベントの再試行に任せる', async () => {
    const error = new Error('D1が一時的に応答しない');
    const { handler } = createHarness(error);

    const caught = await handler
      .handle(EVENT)
      .catch((thrown: unknown) => thrown);

    expect(caught).toBe(error);
  });
});
