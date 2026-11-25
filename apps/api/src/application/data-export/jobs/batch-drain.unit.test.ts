import { describe, expect, test } from 'bun:test';

import { type DrainOutcome, drainInBatches } from './batch-drain.ts';

interface Item {
  readonly id: string;
}

const itemsOf = (count: number, from = 0): Item[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `item-${String(from + index)}`,
  }));

const resolved = (): Promise<DrainOutcome> => Promise.resolve('resolved');

describe('drainInBatches', () => {
  test('1件も読めなければ何も処理せず1回だけ読んで終える', async () => {
    const limits: number[] = [];
    const handled: string[] = [];

    const result = await drainInBatches({
      batchSize: 100,
      maxBatches: 10,
      list: (limit) => {
        limits.push(limit);
        return Promise.resolve([]);
      },
      handle: (item: Item) => {
        handled.push(item.id);
        return resolved();
      },
    });

    expect(limits).toEqual([100]);
    expect(handled).toEqual([]);
    expect(result).toEqual({
      handled: 0,
      retained: 0,
      batches: 1,
      limitReached: false,
    });
  });

  test('1回の件数に満たない読み取りで終え、読み取りの上限に件数を渡す', async () => {
    const handled: string[] = [];

    const result = await drainInBatches({
      batchSize: 3,
      maxBatches: 10,
      list: () => Promise.resolve(itemsOf(2)),
      handle: (item: Item) => {
        handled.push(item.id);
        return resolved();
      },
    });

    expect(handled).toEqual(['item-0', 'item-1']);
    expect(result).toEqual({
      handled: 2,
      retained: 0,
      batches: 1,
      limitReached: false,
    });
  });

  test('処理した項目が読み取りから消える間は、1回の件数ずつ最大回数まで繰り返し、上限に達したことを返す', async () => {
    let remaining = itemsOf(7);
    const limits: number[] = [];
    const handled: string[] = [];

    const result = await drainInBatches({
      batchSize: 2,
      maxBatches: 3,
      list: (limit) => {
        limits.push(limit);
        return Promise.resolve(remaining.slice(0, limit));
      },
      handle: (item: Item) => {
        handled.push(item.id);
        remaining = remaining.filter(({ id }) => id !== item.id);
        return resolved();
      },
    });

    expect(limits).toEqual([2, 2, 2]);
    expect(handled).toEqual([
      'item-0',
      'item-1',
      'item-2',
      'item-3',
      'item-4',
      'item-5',
    ]);
    expect(remaining).toEqual([{ id: 'item-6' }]);
    expect(result).toEqual({
      handled: 6,
      retained: 0,
      batches: 3,
      limitReached: true,
    });
  });

  test('読み取りに残り続ける項目は同じ実行で2度処理せず、残った件数だけ読む件数を増やして後ろの項目へ進む', async () => {
    const stuck = itemsOf(3);
    let healthy = itemsOf(3, 10);
    const limits: number[] = [];
    const handled: string[] = [];

    const result = await drainInBatches({
      batchSize: 3,
      maxBatches: 10,
      list: (limit) => {
        limits.push(limit);
        return Promise.resolve([...stuck, ...healthy].slice(0, limit));
      },
      handle: (item: Item) => {
        handled.push(item.id);
        if (stuck.includes(item)) {
          return Promise.resolve('retained');
        }
        healthy = healthy.filter(({ id }) => id !== item.id);
        return resolved();
      },
    });

    expect(limits).toEqual([3, 6, 6]);
    expect(handled).toEqual([
      'item-0',
      'item-1',
      'item-2',
      'item-10',
      'item-11',
      'item-12',
    ]);
    expect(result).toEqual({
      handled: 6,
      retained: 3,
      batches: 3,
      limitReached: false,
    });
  });

  test('読み取りが処理済みの項目だけになったら、最大回数を待たずに終える', async () => {
    const stuck = itemsOf(3);
    let reads = 0;

    const result = await drainInBatches({
      batchSize: 3,
      maxBatches: 10,
      list: (limit) => {
        reads += 1;
        return Promise.resolve(stuck.slice(0, limit));
      },
      handle: () => Promise.resolve('retained'),
    });

    expect(reads).toBe(2);
    expect(result).toEqual({
      handled: 3,
      retained: 3,
      batches: 2,
      limitReached: false,
    });
  });

  test('項目の処理の例外はそのまま投げ、後の項目を処理しない', async () => {
    const handled: string[] = [];

    const failure = await drainInBatches({
      batchSize: 3,
      maxBatches: 10,
      list: () => Promise.resolve(itemsOf(3)),
      handle: (item: Item) => {
        handled.push(item.id);
        return item.id === 'item-1'
          ? Promise.reject(new Error('D1に接続できません'))
          : resolved();
      },
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toEqual(new Error('D1に接続できません'));
    expect(handled).toEqual(['item-0', 'item-1']);
  });
});
