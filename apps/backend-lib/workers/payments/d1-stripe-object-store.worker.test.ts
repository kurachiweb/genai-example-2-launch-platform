import { beforeEach, describe, expect, test } from 'vitest';

import { D1StripeObjectStore } from './d1-stripe-object-store.ts';
import {
  after,
  clearPaymentTables,
  db,
  readStripeObjects,
} from './testing/payment-store-fixtures.ts';

const store = new D1StripeObjectStore(db);

async function advance(objectId: string, occurredAt: Date): Promise<void> {
  const { statement } = store.advanceGuarded({
    objectId,
    objectType: 'subscription',
    occurredAt,
  });
  await db.batch([statement]);
}

beforeEach(async () => {
  await clearPaymentTables();
});

describe('D1StripeObjectStore', () => {
  test('記録済みの最後の発生時刻を返し、無いオブジェクトはundefinedを返す', async () => {
    await advance('sub_1', after(10));
    await advance('sub_2', after(20));

    expect(await store.findLastEventAt('sub_1')).toEqual(after(10));
    expect(await store.findLastEventAt('sub_2')).toEqual(after(20));
    expect(await store.findLastEventAt('sub_none')).toBeUndefined();
  });

  test('前進の文はオブジェクトのIDごとに1行を保ち、最後の発生時刻を更新する', async () => {
    await advance('sub_1', after(10));
    await advance('sub_1', after(30));

    expect(await readStripeObjects()).toMatchObject([
      { objectId: 'sub_1', lastEventAt: after(30) },
    ]);
  });

  test('前進の文は検査の列として最後の発生時刻を示す', () => {
    expect(
      store.advanceGuarded({
        objectId: 'sub_1',
        objectType: 'subscription',
        occurredAt: after(1),
      }).guardColumn,
    ).toBe('payment_stripe_objects.last_event_at');
  });

  test('より新しい発生時刻が記録済みなら、前進の文は検査の列のNOT NULLの違反で失敗する', async () => {
    await advance('sub_1', after(30));

    await expect(advance('sub_1', after(29))).rejects.toSatisfy(
      (error: unknown) => {
        for (
          let current = error;
          current instanceof Error;
          current = current.cause
        ) {
          if (
            current.message.includes(
              'NOT NULL constraint failed: payment_stripe_objects.last_event_at',
            )
          ) {
            return true;
          }
        }
        return false;
      },
    );
    expect(await store.findLastEventAt('sub_1')).toEqual(after(30));
  });
});
