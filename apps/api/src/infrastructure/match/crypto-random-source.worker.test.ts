import { describe, expect, test } from 'vitest';

import { CryptoRandomSource } from './crypto-random-source.ts';

const DRAWS = 2000;

describe('CryptoRandomSource.nextInt', () => {
  test.each([1, 2, 3, 7, 1000, 2 ** 32])(
    '上限%iを渡すと0以上で上限未満の整数を返す',
    (exclusiveMax) => {
      const random = new CryptoRandomSource();

      const values = Array.from({ length: DRAWS }, () =>
        random.nextInt(exclusiveMax),
      );

      for (const value of values) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(exclusiveMax);
      }
    },
  );

  test('上限の範囲の全ての値を返し得る', () => {
    const random = new CryptoRandomSource();

    const values = new Set(
      Array.from({ length: DRAWS }, () => random.nextInt(3)),
    );

    expect([...values].toSorted()).toEqual([0, 1, 2]);
  });

  test('同じ上限で呼んでも決まった並びを返さない', () => {
    const first = Array.from({ length: 32 }, () =>
      new CryptoRandomSource().nextInt(2 ** 32),
    );
    const second = Array.from({ length: 32 }, () =>
      new CryptoRandomSource().nextInt(2 ** 32),
    );

    expect(first).not.toEqual(second);
  });

  test.each([0, -1, 1.5, 2 ** 32 + 1])(
    '1〜2^32の整数でない上限%sはRangeErrorにする',
    (exclusiveMax) => {
      expect(() => new CryptoRandomSource().nextInt(exclusiveMax)).toThrow(
        RangeError,
      );
    },
  );
});
