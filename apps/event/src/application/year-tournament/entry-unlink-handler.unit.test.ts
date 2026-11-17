import { describe, expect, test } from 'bun:test';

import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { YearEntryStore } from '../../../lib/core/year-tournament/ports.ts';
import { EntryUnlinkHandler } from './entry-unlink-handler.ts';

const PRODUCT_ID = '01JD0PR0D00000000000000001';

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JD0PEVT00000000000000001',
  productId: PRODUCT_ID,
  ownerUserId: '01JD0USER00000000000000001',
  type: 'purge_due',
  occurredAt: new Date('2027-04-10T09:00:00.000Z'),
});

function notUsed(): never {
  throw new Error('物理削除の紐付けの解除の処理はこの操作を使わない');
}

interface Harness {
  readonly handler: EntryUnlinkHandler;
  readonly unlinked: string[];
}

function createHarness(failure?: Error): Harness {
  const unlinked: string[] = [];
  const store: YearEntryStore = {
    insertFromChampion: notUsed,
    findByWeekTournaments: notUsed,
    findByLaunches: notUsed,
    findEntry: notUsed,
    listOpenByOwner: notUsed,
    listLaunchIdsByProduct: notUsed,
    listCandidates: notUsed,
    listDrawn: notUsed,
    grantByUltras: notUsed,
    forfeitByProduct: notUsed,
    forfeitByOwner: notUsed,
    classify: notUsed,
    excludeOverCapacity: notUsed,
    listPendingFollowUps: notUsed,
    markRefundRequested: notUsed,
    markRefundClosed: notUsed,
    markNotice: notUsed,
    unlinkOrDeleteByProduct: (productId) => {
      unlinked.push(productId);
      return failure === undefined
        ? Promise.resolve({ unlinked: 1, deleted: 2 })
        : Promise.reject(failure);
    },
  };
  return { handler: new EntryUnlinkHandler(store), unlinked };
}

describe('EntryUnlinkHandler', () => {
  test('物理削除の時期に、プロダクトの組み合わせに入った枠の紐付けの解除とそれ以外の枠の削除を行って完了を返す', async () => {
    const { handler, unlinked } = createHarness();

    const outcome = await handler.handle(EVENT);

    expect(outcome).toEqual({ kind: 'done' });
    expect(unlinked).toEqual([PRODUCT_ID]);
  });

  test('紐付けの解除と削除の失敗はそのまま投げ、イベントの再試行に任せる', async () => {
    const error = new Error('D1が一時的に応答しない');
    const { handler } = createHarness(error);

    const caught = await handler
      .handle(EVENT)
      .catch((thrown: unknown) => thrown);

    expect(caught).toBe(error);
  });
});
