import { beforeEach, describe, expect, test } from 'vitest';

import type { StripePrice } from '../../core/payments/ports.ts';
import { D1PriceSnapshotStore } from './d1-price-snapshot-store.ts';
import {
  after,
  clearPaymentTables,
  createRecordingDatabase,
  db,
} from './testing/payment-store-fixtures.ts';

const MAX_BOUND_PARAMETERS = 100;

const store = new D1PriceSnapshotStore(db);

function priceOf(
  index: number,
  columns: Partial<StripePrice> = {},
): StripePrice {
  return {
    lookupKey: `lookup_${String(index).padStart(3, '0')}`,
    priceId: `price_${String(index)}`,
    unitAmount: 100 + index,
    currency: 'usd',
    recurringInterval: null,
    ...columns,
  };
}

beforeEach(async () => {
  await clearPaymentTables();
});

describe('D1PriceSnapshotStore', () => {
  test('保存した価格を取得時刻とともに返し、無いキーは結果に含めない', async () => {
    const monthly = priceOf(2, { recurringInterval: 'month' });
    await store.saveMany([priceOf(1), monthly], after(10));

    const found = await store.findMany([
      monthly.lookupKey,
      priceOf(1).lookupKey,
      'lookup_none',
    ]);

    expect(
      [...found].sort((a, b) => a.lookupKey.localeCompare(b.lookupKey)),
    ).toEqual([
      { ...priceOf(1), fetchedAt: after(10) },
      { ...monthly, fetchedAt: after(10) },
    ]);
  });

  test('同じキーの2回目の保存は価格と取得時刻を置き換える', async () => {
    await store.saveMany([priceOf(1)], after(10));
    await store.saveMany(
      [priceOf(1, { priceId: 'price_new', unitAmount: 999 })],
      after(20),
    );

    expect(await store.findMany([priceOf(1).lookupKey])).toEqual([
      {
        ...priceOf(1, { priceId: 'price_new', unitAmount: 999 }),
        fetchedAt: after(20),
      },
    ]);
  });

  test('空の一覧ではD1へ問い合わせない', async () => {
    const recording = createRecordingDatabase();
    const recordingStore = new D1PriceSnapshotStore(recording.database);

    await recordingStore.saveMany([], after(10));

    expect(await recordingStore.findMany([])).toEqual([]);
    expect(recording.placeholderCounts).toEqual([]);
  });

  test('多数の価格の保存と照会は、各文のバインド変数を上限内に分ける', async () => {
    const prices = Array.from({ length: 130 }, (_, index) => priceOf(index));
    const recording = createRecordingDatabase();
    const recordingStore = new D1PriceSnapshotStore(recording.database);

    await recordingStore.saveMany(prices, after(10));
    const found = await recordingStore.findMany(
      prices.map(({ lookupKey }) => lookupKey),
    );

    expect(found).toHaveLength(prices.length);
    expect(recording.placeholderCounts.length).toBeGreaterThan(2);
    expect(Math.max(...recording.placeholderCounts)).toBeLessThanOrEqual(
      MAX_BOUND_PARAMETERS,
    );
  });
});
