import { describe, expect, test } from 'bun:test';

import type { DirectoryEntryStore } from '../../../lib/core/directory/ports.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { SearchIndexRefreshRequester } from '../../../lib/core/search/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { AccountIndexRestoreHandler } from './account-index-restore-handler.ts';
import {
  MAX_PRODUCTS_PER_PENDING_MARK,
  PRODUCT_SEARCH_TARGET_NAME,
  type ProductIndexPendingMarker,
} from './ports.ts';

const NOW = new Date('2026-12-02T03:00:05.000Z');

const OWNER_ID = '01JD0USER00000000000000001';

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JD0UEVT00000000000000001',
  userId: OWNER_ID,
  type: 'unsuspended',
  occurredAt: new Date('2026-12-02T03:00:00.000Z'),
});

const clock: Clock = { now: () => NOW };

function productIdsOf(count: number): readonly string[] {
  return Array.from(
    { length: count },
    (_, index) => `01JD0PROD${String(index + 1).padStart(17, '0')}`,
  );
}

function notUsed(): never {
  throw new Error('停止の解除の処理はこの操作を使わない');
}

interface Lookup {
  readonly ownerUserId: string;
  readonly after: string | undefined;
  readonly limit: number;
}

interface Harness {
  readonly handler: AccountIndexRestoreHandler;
  readonly lookups: Lookup[];
  readonly marks: {
    readonly productIds: readonly string[];
    readonly at: Date;
  }[];
  readonly refreshes: { readonly target: string; readonly sourceId: string }[];
}

// 記録のストアは投稿者のプロダクトのIDを昇順に持ち、afterより後をlimit件まで返す
function createHarness(
  owned: readonly string[],
  failure?: { readonly onMark: number; readonly error: Error },
): Harness {
  const lookups: Lookup[] = [];
  const marks: Harness['marks'] = [];
  const refreshes: Harness['refreshes'] = [];
  const entries: DirectoryEntryStore = {
    record: notUsed,
    exists: notUsed,
    listProductIdsByOwner: (ownerUserId, after, limit) => {
      lookups.push({ ownerUserId, after, limit });
      const rest =
        ownerUserId === OWNER_ID
          ? owned.filter(
              (productId) => after === undefined || productId > after,
            )
          : [];
      return Promise.resolve(rest.slice(0, limit));
    },
    erase: notUsed,
  };
  const pendingMarker: ProductIndexPendingMarker = {
    mark: (productIds, at) => {
      marks.push({ productIds, at });
      return failure?.onMark === marks.length
        ? Promise.reject(failure.error)
        : Promise.resolve();
    },
  };
  const requester: SearchIndexRefreshRequester = {
    requestRefresh: (target, sourceId) => {
      refreshes.push({ target, sourceId });
      return Promise.resolve();
    },
  };
  return {
    handler: new AccountIndexRestoreHandler(
      entries,
      pendingMarker,
      requester,
      clock,
    ),
    lookups,
    marks,
    refreshes,
  };
}

function refreshesOf(productIds: readonly string[]): Harness['refreshes'] {
  return productIds.map((sourceId) => ({
    target: PRODUCT_SEARCH_TARGET_NAME,
    sourceId,
  }));
}

describe('投稿者の停止の解除による索引の作り直しの処理', () => {
  test('1回の実行で投稿者の全ての記録を100件ずつ更新待ちにし、全てのプロダクトの索引の更新を要求して完了する', async () => {
    const owned = productIdsOf(250);
    const harness = createHarness(owned);

    const outcome = await harness.handler.handle(EVENT);

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.lookups).toStrictEqual([
      { ownerUserId: OWNER_ID, after: undefined, limit: 100 },
      { ownerUserId: OWNER_ID, after: owned[99], limit: 100 },
      { ownerUserId: OWNER_ID, after: owned[199], limit: 100 },
    ]);
    expect(harness.marks).toStrictEqual([
      { productIds: owned.slice(0, 100), at: NOW },
      { productIds: owned.slice(100, 200), at: NOW },
      { productIds: owned.slice(200), at: NOW },
    ]);
    expect(harness.refreshes).toStrictEqual(refreshesOf(owned));
  });

  test('1回に更新待ちにする件数は更新待ちの書き込みの単位の上限と同じである', async () => {
    const harness = createHarness(productIdsOf(1));

    await harness.handler.handle(EVENT);

    expect(harness.lookups.map(({ limit }) => limit)).toStrictEqual([
      MAX_PRODUCTS_PER_PENDING_MARK,
    ]);
  });

  test('上限ちょうどの件数の後は、続きの照会が0件を返して更新待ちの書き込みを増やさずに完了する', async () => {
    const owned = productIdsOf(100);
    const harness = createHarness(owned);

    const outcome = await harness.handler.handle(EVENT);

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.lookups.map(({ after }) => after)).toStrictEqual([
      undefined,
      owned[99],
    ]);
    expect(harness.marks).toStrictEqual([{ productIds: owned, at: NOW }]);
    expect(harness.refreshes).toStrictEqual(refreshesOf(owned));
  });

  test('記録の無い投稿者は、更新待ちにも索引の更新の要求もせずに完了する', async () => {
    const harness = createHarness([]);

    const outcome = await harness.handler.handle(EVENT);

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.lookups).toHaveLength(1);
    expect(harness.marks).toStrictEqual([]);
    expect(harness.refreshes).toStrictEqual([]);
  });

  test('同じイベントで2回呼んでも、最初から同じ書き込みと要求を繰り返して完了する', async () => {
    const owned = productIdsOf(120);
    const harness = createHarness(owned);

    await harness.handler.handle(EVENT);
    const outcome = await harness.handler.handle(EVENT);

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.marks.slice(2)).toStrictEqual(harness.marks.slice(0, 2));
    expect(harness.refreshes).toStrictEqual([
      ...refreshesOf(owned),
      ...refreshesOf(owned),
    ]);
  });

  test('途中の更新待ちの書き込みの失敗は捕まえずに投げ、その100件の索引の更新を要求しない', async () => {
    const owned = productIdsOf(150);
    const error = new Error('D1 unavailable');
    const harness = createHarness(owned, { onMark: 2, error });

    const caught = await harness.handler
      .handle(EVENT)
      .catch((thrown: unknown) => thrown);

    expect(caught).toBe(error);
    expect(harness.refreshes).toStrictEqual(refreshesOf(owned.slice(0, 100)));
  });
});
