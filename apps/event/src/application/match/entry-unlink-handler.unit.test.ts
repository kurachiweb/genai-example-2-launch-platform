import { describe, expect, test } from 'bun:test';

import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { EntryUnlinkHandler } from './entry-unlink-handler.ts';
import type { MatchPurgeStore } from './ports.ts';

const NOW = new Date('2026-12-20T03:00:05.000Z');

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JD0PEVT00000000000000081',
  productId: '01JD0PRDT00000000000000004',
  ownerUserId: '01JD0USER00000000000000002',
  type: 'purge_due',
  occurredAt: new Date('2026-12-20T03:00:00.000Z'),
});

const clock: Clock = { now: () => NOW };

function unexpected(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

// プロダクトの側の紐付けの解除だけを記録し、利用者の側の操作は呼ばれたら失敗させる
function createFakeStore(failure?: Error): {
  readonly store: MatchPurgeStore;
  readonly unlinked: readonly (readonly [string, Date])[];
} {
  const unlinked: (readonly [string, Date])[] = [];
  return {
    store: {
      deleteUpvotesBatch: unexpected,
      clearOwner: unexpected,
      unlinkProduct: (productId, at) => {
        unlinked.push([productId, at]);
        return failure === undefined
          ? Promise.resolve()
          : Promise.reject(failure);
      },
    },
    unlinked,
  };
}

describe('EntryUnlinkHandler', () => {
  test('プロダクトの側の紐付けを現在の日時で外して完了を返す', async () => {
    const { store, unlinked } = createFakeStore();

    expect(
      await new EntryUnlinkHandler(store, clock).handle(EVENT),
    ).toStrictEqual({ kind: 'done' });
    expect(unlinked).toStrictEqual([[EVENT.productId, NOW]]);
  });

  test('2回呼んでも同じ操作を繰り返して完了を返す', async () => {
    const { store, unlinked } = createFakeStore();
    const handler = new EntryUnlinkHandler(store, clock);

    await handler.handle(EVENT);
    expect(await handler.handle(EVENT)).toStrictEqual({
      kind: 'done',
    });
    expect(unlinked).toStrictEqual([
      [EVENT.productId, NOW],
      [EVENT.productId, NOW],
    ]);
  });

  test('紐付けの解除の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const { store } = createFakeStore(failure);

    expect(
      await new EntryUnlinkHandler(store, clock)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
