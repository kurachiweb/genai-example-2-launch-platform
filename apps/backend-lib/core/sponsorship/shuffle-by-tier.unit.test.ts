import { describe, expect, test } from 'bun:test';

import { createUniformRandom, shuffleByTier } from './shuffle-by-tier.ts';

const UINT32_RANGE = 2 ** 32;

function drawsOf(values: readonly number[]): {
  readonly nextUint32: () => number;
  readonly drawn: () => number;
} {
  let position = 0;
  return {
    nextUint32() {
      const value = values[position];
      position += 1;
      if (value === undefined) {
        throw new Error('用意した乱数を使い切った');
      }
      return value;
    },
    drawn: () => position,
  };
}

describe('createUniformRandom', () => {
  test('32ビットの乱数の上限で割った余りを返す', () => {
    const { nextUint32 } = drawsOf([7, 0, 5]);
    const random = createUniformRandom(nextUint32);

    expect([random(3), random(3), random(3)]).toEqual([1, 0, 2]);
  });

  test('2^32が上限で割り切れない端数の範囲の乱数を捨てて引き直す', () => {
    // 2^32 = 3 × 1431655765 + 1 のため、受け入れる上限は2^32 - 1
    const { nextUint32, drawn } = drawsOf([UINT32_RANGE - 1, 4]);
    const random = createUniformRandom(nextUint32);

    expect(random(3)).toBe(1);
    expect(drawn()).toBe(2);
  });

  test('端数の範囲の直前の乱数は捨てない', () => {
    const { nextUint32, drawn } = drawsOf([UINT32_RANGE - 2]);
    const random = createUniformRandom(nextUint32);

    expect(random(3)).toBe((UINT32_RANGE - 2) % 3);
    expect(drawn()).toBe(1);
  });

  test('上限が2^32を割り切るなら端数を捨てない', () => {
    const { nextUint32, drawn } = drawsOf([UINT32_RANGE - 1]);
    const random = createUniformRandom(nextUint32);

    expect(random(4)).toBe(3);
    expect(drawn()).toBe(1);
  });

  test('上限が1なら常に0', () => {
    const { nextUint32 } = drawsOf([UINT32_RANGE - 1]);

    expect(createUniformRandom(nextUint32)(1)).toBe(0);
  });

  test.each([0, -1, 1.5, UINT32_RANGE + 1, Number.NaN])(
    '上限が1〜2^32の整数でなければRangeError(%p)',
    (bound) => {
      const random = createUniformRandom(drawsOf([0]).nextUint32);

      expect(() => random(bound)).toThrow(RangeError);
    },
  );

  test.each([-1, UINT32_RANGE, 0.5, Number.NaN])(
    '32ビットの符号なし整数でない乱数はRangeError(%p)',
    (value) => {
      const random = createUniformRandom(drawsOf([value]).nextUint32);

      expect(() => random(3)).toThrow(RangeError);
    },
  );
});

function sequenceRandom(values: readonly number[]): {
  readonly random: (bound: number) => number;
  readonly bounds: number[];
} {
  const bounds: number[] = [];
  let position = 0;
  return {
    bounds,
    random(bound) {
      bounds.push(bound);
      const value = values[position] ?? 0;
      position += 1;
      return value;
    },
  };
}

function choicesOf(bounds: readonly number[]): number[][] {
  return bounds.reduce<number[][]>(
    (sequences, bound) =>
      sequences.flatMap((sequence) =>
        Array.from({ length: bound }, (_, value) => [...sequence, value]),
      ),
    [[]],
  );
}

describe('shuffleByTier', () => {
  test('乱数の全ての組み合わせで、要素の全ての並びを作る', () => {
    const items = ['a', 'b', 'c', 'd'];
    const orders = new Set(
      choicesOf([4, 3, 2]).map((values) =>
        shuffleByTier(items, sequenceRandom(values).random).join(''),
      ),
    );

    expect(orders.size).toBe(24);
  });

  test('乱数の上限を末尾の位置から順に要素の数〜2で求める', () => {
    const { random, bounds } = sequenceRandom([0, 0, 0, 0]);

    shuffleByTier(['a', 'b', 'c', 'd', 'e'], random);

    expect(bounds).toEqual([5, 4, 3, 2]);
  });

  test('乱数が上限未満の最大の値ばかりなら元の順のまま', () => {
    const { random } = sequenceRandom([3, 2, 1]);

    expect(shuffleByTier(['a', 'b', 'c', 'd'], random)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  test('乱数が0ばかりなら、各位置を先頭の要素と入れ替えた並びになる', () => {
    const { random } = sequenceRandom([0, 0, 0]);

    expect(shuffleByTier(['a', 'b', 'c', 'd'], random)).toEqual([
      'b',
      'c',
      'd',
      'a',
    ]);
  });

  test('元の配列を変えずに新しい配列を返す', () => {
    const items = Object.freeze(['a', 'b', 'c']);

    const shuffled = shuffleByTier(items, sequenceRandom([0, 0]).random);

    expect(shuffled).not.toBe(items);
    expect(items).toEqual(['a', 'b', 'c']);
    expect(shuffled.toSorted()).toEqual(['a', 'b', 'c']);
  });

  test.each([[[]], [['a']]])(
    '要素が1件以下なら乱数を使わない(%j)',
    (items: readonly string[]) => {
      const { random, bounds } = sequenceRandom([]);

      expect(shuffleByTier(items, random)).toEqual(items);
      expect(bounds).toEqual([]);
    },
  );

  test.each([-1, 3, 1.5, Number.NaN])(
    '乱数が0以上上限未満の整数でなければRangeError(%p)',
    (value) => {
      expect(() =>
        shuffleByTier(['a', 'b', 'c'], sequenceRandom([value]).random),
      ).toThrow(RangeError);
    },
  );
});
