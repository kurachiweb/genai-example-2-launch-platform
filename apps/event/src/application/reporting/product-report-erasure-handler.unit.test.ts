import { describe, expect, test } from 'bun:test';

import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { ReportErasureStore } from '../../../lib/core/reporting/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  PRODUCT_REPORT_ERASURE_BATCH_SIZE,
  ProductReportErasureHandler,
} from './product-report-erasure-handler.ts';

const NOW = new Date('2026-12-20T03:00:05.000Z');

const clock: Clock = { now: () => NOW };

const EVENT: ProductLifecycleEvent = Object.freeze({
  id: '01JQ0PEV000000000000000181',
  productId: '01JQ0PRD000000000000000004',
  ownerUserId: '01JQ0USR000000000000000004',
  type: 'purge_due',
  occurredAt: new Date('2026-12-20T03:00:00.000Z'),
});

interface DetachCall {
  readonly productId: string;
  readonly at: Date;
  readonly limit: number;
}

function unexpected(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

// プロダクトの案件の参照の消去だけを記録し、案件・通報の削除を含む他の操作は呼ばれたら失敗させる
function createFakeStore(remainings: readonly boolean[]): {
  readonly store: ReportErasureStore;
  readonly calls: readonly DetachCall[];
} {
  const calls: DetachCall[] = [];
  const pending = [...remainings];
  return {
    store: {
      eraseByReporter: unexpected,
      detachCasesByOwner: unexpected,
      detachCasesByProduct: (productId, at, limit) => {
        calls.push({ productId, at, limit });
        const remaining = pending.shift();
        return remaining === undefined
          ? unexpected()
          : Promise.resolve({ remaining });
      },
      eraseGuestReportsClosedBefore: unexpected,
      eraseDetachedCasesBefore: unexpected,
      eraseEmptyCases: unexpected,
    },
    calls,
  };
}

describe('ProductReportErasureHandler', () => {
  test('1回に参照を消す案件の上限は500件である', () => {
    expect(PRODUCT_REPORT_ERASURE_BATCH_SIZE).toBe(500);
  });

  test('プロダクトとそのコメントの案件の対象への参照の消去だけを上限と実行時刻で1回呼び、残りがあれば続きを返す', async () => {
    const { store, calls } = createFakeStore([true]);

    expect(
      await new ProductReportErasureHandler(store, clock).handle(EVENT),
    ).toStrictEqual({ kind: 'continue' });
    expect(calls).toStrictEqual([
      {
        productId: EVENT.productId,
        at: NOW,
        limit: PRODUCT_REPORT_ERASURE_BATCH_SIZE,
      },
    ]);
  });

  test('残りが無ければ完了を返す', async () => {
    const { store, calls } = createFakeStore([false]);

    expect(
      await new ProductReportErasureHandler(store, clock).handle(EVENT),
    ).toStrictEqual({ kind: 'done' });
    expect(calls).toHaveLength(1);
  });

  test('続きの呼び出しで残りが尽きた回に完了を返し、同じイベントの呼び直しでも完了を返す', async () => {
    const { store, calls } = createFakeStore([true, false, false]);
    const handler = new ProductReportErasureHandler(store, clock);

    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'continue' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(calls).toHaveLength(3);
  });

  test('参照の消去の失敗は捕まえずに投げ、メッセージの再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const { store } = createFakeStore([]);
    const failing: ReportErasureStore = {
      ...store,
      detachCasesByProduct: () => Promise.reject(failure),
    };

    expect(
      await new ProductReportErasureHandler(failing, clock)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
  });
});
