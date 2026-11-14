import { describe, expect, test } from 'bun:test';

import type { DirectoryEntryStore } from '../../../lib/core/directory/ports.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { SearchIndexRefreshRequester } from '../../../lib/core/search/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  PRODUCT_SEARCH_TARGET_NAME,
  type ProductIndexPendingMarker,
} from './ports.ts';
import { ProductIndexRestoreHandler } from './product-index-restore-handler.ts';

const NOW = new Date('2026-12-02T03:00:05.000Z');

const PRODUCT_ID = '01JD0PROD00000000000000001';

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JD0PEVT00000000000000001',
  productId: PRODUCT_ID,
  ownerUserId: '01JD0USER00000000000000001',
  type: 'unhidden',
  occurredAt: new Date('2026-12-02T03:00:00.000Z'),
});

const clock: Clock = { now: () => NOW };

function notUsed(): never {
  throw new Error('復元の処理はこの操作を使わない');
}

type Call =
  | { readonly kind: 'exists'; readonly productId: string }
  | {
      readonly kind: 'mark';
      readonly productIds: readonly string[];
      readonly at: Date;
    }
  | {
      readonly kind: 'refresh';
      readonly target: string;
      readonly sourceId: string;
    };

interface Harness {
  readonly handler: ProductIndexRestoreHandler;
  readonly calls: Call[];
}

function createHarness(
  recorded: boolean,
  failure?: { readonly on: Call['kind']; readonly error: Error },
): Harness {
  const calls: Call[] = [];
  const settle = <T>(call: Call, value: T): Promise<T> => {
    calls.push(call);
    return failure?.on === call.kind
      ? Promise.reject(failure.error)
      : Promise.resolve(value);
  };
  const entries: DirectoryEntryStore = {
    record: notUsed,
    exists: (productId) => settle({ kind: 'exists', productId }, recorded),
    listProductIdsByOwner: notUsed,
    erase: notUsed,
  };
  const pendingMarker: ProductIndexPendingMarker = {
    mark: (productIds, at) =>
      settle({ kind: 'mark', productIds, at }, undefined),
  };
  const requester: SearchIndexRefreshRequester = {
    requestRefresh: (target, sourceId) =>
      settle({ kind: 'refresh', target, sourceId }, undefined),
  };
  return {
    handler: new ProductIndexRestoreHandler(
      entries,
      pendingMarker,
      requester,
      clock,
    ),
    calls,
  };
}

describe('プロダクトの復元による索引の作り直しの処理', () => {
  test('掲載の記録があるプロダクトは、処理の時刻で索引文書を更新待ちにしてから索引の更新を要求して完了する', async () => {
    const harness = createHarness(true);

    const outcome = await harness.handler.handle(EVENT);

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.calls).toStrictEqual([
      { kind: 'exists', productId: PRODUCT_ID },
      { kind: 'mark', productIds: [PRODUCT_ID], at: NOW },
      {
        kind: 'refresh',
        target: PRODUCT_SEARCH_TARGET_NAME,
        sourceId: PRODUCT_ID,
      },
    ]);
  });

  test('掲載の記録が無いプロダクトは、更新待ちにも索引の更新の要求もせずに完了する', async () => {
    const harness = createHarness(false);

    const outcome = await harness.handler.handle(EVENT);

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.calls).toStrictEqual([
      { kind: 'exists', productId: PRODUCT_ID },
    ]);
  });

  test('同じイベントで2回呼んでも、同じ書き込みと要求を繰り返して完了する', async () => {
    const harness = createHarness(true);

    await harness.handler.handle(EVENT);
    const outcome = await harness.handler.handle(EVENT);

    expect(outcome).toStrictEqual({ kind: 'done' });
    expect(harness.calls.slice(3)).toStrictEqual(harness.calls.slice(0, 3));
  });

  test.each(['exists', 'mark'] as const)(
    '%sの失敗は捕まえずに投げ、索引の更新を要求しない',
    async (on) => {
      const error = new Error('D1 unavailable');
      const harness = createHarness(true, { on, error });

      const caught = await harness.handler
        .handle(EVENT)
        .catch((thrown: unknown) => thrown);

      expect(caught).toBe(error);
      expect(harness.calls.at(-1)?.kind).toBe(on);
      expect(harness.calls.some(({ kind }) => kind === 'refresh')).toBe(false);
    },
  );
});
