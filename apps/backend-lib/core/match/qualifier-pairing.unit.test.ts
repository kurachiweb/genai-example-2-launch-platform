import { describe, expect, test } from 'bun:test';

import {
  createUniformRandomSource,
  type PairingCandidate,
  pairQualifiers,
  type RandomSource,
} from './qualifier-pairing.ts';

const UINT32_RANGE = 2 ** 32;

interface ScriptedRandom extends RandomSource {
  readonly requested: readonly number[];
  readonly remaining: () => number;
}

function scriptedRandom(values: readonly number[]): ScriptedRandom {
  const queue = [...values];
  const requested: number[] = [];
  return {
    requested,
    remaining: () => queue.length,
    nextInt(exclusiveMax) {
      requested.push(exclusiveMax);
      const value = queue.shift();
      if (value === undefined || value < 0 || value >= exclusiveMax) {
        throw new Error(
          `用意した乱数が範囲外です: ${String(value)} / ${String(exclusiveMax)}`,
        );
      }
      return value;
    },
  };
}

// Fisher–Yatesで常に交換しない(自分自身と交換する)乱数で、入力の順を保つ
function identityRandom(): RandomSource {
  return { nextInt: (exclusiveMax) => exclusiveMax - 1 };
}

function candidate(
  launchId: string,
  categoryId: string,
  ownerUserId = `owner-${launchId}`,
): PairingCandidate {
  return {
    launchId,
    productId: `product-${launchId}`,
    ownerUserId,
    categoryId,
  };
}

function launchIdsOf(result: ReturnType<typeof pairQualifiers>): {
  readonly pairs: readonly (readonly [string, string])[];
  readonly bye: string | null;
} {
  return {
    pairs: result.pairs.map(([a, b]) => [a.launchId, b.launchId] as const),
    bye: result.bye?.launchId ?? null,
  };
}

describe('pairQualifiers', () => {
  test('予選ルールの9個の例を、決まった乱数で手順どおりに組む', () => {
    const candidates = [
      candidate('A1', 'cat-ai'),
      candidate('D1', 'cat-dev'),
      candidate('A2', 'cat-ai'),
      candidate('O1', 'cat-other'),
      candidate('A3', 'cat-ai'),
      candidate('D2', 'cat-dev'),
      candidate('A4', 'cat-ai'),
      candidate('D3', 'cat-dev'),
      candidate('A5', 'cat-ai'),
    ];
    // AI[A1..A5]→[A3,A1,A5,A2,A4]、開発ツール[D1..D3]→[D2,D3,D1]、余り[A4,D1,O1]→[D1,O1,A4]
    const random = scriptedRandom([3, 1, 1, 0, 0, 0, 0, 0]);

    const result = pairQualifiers(candidates, random);

    expect(launchIdsOf(result)).toEqual({
      pairs: [
        ['A3', 'A1'],
        ['A5', 'A2'],
        ['D2', 'D3'],
        ['D1', 'O1'],
      ],
      bye: 'A4',
    });
    expect(random.requested).toEqual([5, 4, 3, 2, 3, 2, 3, 2]);
    expect(random.remaining()).toBe(0);
  });

  test('組んだ側は入力の候補そのものを持つ', () => {
    const a = candidate('A1', 'cat-ai');
    const b = candidate('A2', 'cat-ai');

    const result = pairQualifiers([a, b], identityRandom());

    expect(result.pairs).toEqual([[a, b]]);
    expect(result.pairs[0]?.[0]).toBe(a);
    expect(result.bye).toBeNull();
  });

  test('カテゴリの処理の順は入力の順によらずカテゴリのIDの昇順になる', () => {
    const candidates = [
      candidate('Z1', 'cat-z'),
      candidate('Z2', 'cat-z'),
      candidate('B1', 'cat-b'),
      candidate('B2', 'cat-b'),
    ];

    const result = pairQualifiers(candidates, identityRandom());

    expect(launchIdsOf(result)).toEqual({
      pairs: [
        ['B1', 'B2'],
        ['Z1', 'Z2'],
      ],
      bye: null,
    });
  });

  test('全体が偶数個でカテゴリごとに余りが出れば、余り同士を組み不戦勝を作らない', () => {
    const candidates = [
      candidate('A1', 'cat-ai'),
      candidate('A2', 'cat-ai'),
      candidate('A3', 'cat-ai'),
      candidate('D1', 'cat-dev'),
    ];

    const result = pairQualifiers(candidates, identityRandom());

    expect(launchIdsOf(result)).toEqual({
      pairs: [
        ['A1', 'A2'],
        ['A3', 'D1'],
      ],
      bye: null,
    });
  });

  test('1個なら組まずに不戦勝にする', () => {
    const random = scriptedRandom([]);

    const result = pairQualifiers([candidate('A1', 'cat-ai')], random);

    expect(launchIdsOf(result)).toEqual({ pairs: [], bye: 'A1' });
    expect(random.requested).toEqual([]);
  });

  test('0個なら何も組まない', () => {
    const random = scriptedRandom([]);

    expect(pairQualifiers([], random)).toEqual({ pairs: [], bye: null });
    expect(random.requested).toEqual([]);
  });

  test('同じ投稿者のプロダクト同士も避けずに組む(仮5)', () => {
    const candidates = [
      candidate('A1', 'cat-ai', 'owner-same'),
      candidate('A2', 'cat-ai', 'owner-same'),
      candidate('A3', 'cat-ai', 'owner-other'),
      candidate('A4', 'cat-ai', 'owner-other'),
    ];

    const result = pairQualifiers(candidates, identityRandom());

    expect(launchIdsOf(result)).toEqual({
      pairs: [
        ['A1', 'A2'],
        ['A3', 'A4'],
      ],
      bye: null,
    });
  });

  test('入力の配列を書き換えない', () => {
    const candidates = Object.freeze([
      candidate('A1', 'cat-ai'),
      candidate('A2', 'cat-ai'),
      candidate('A3', 'cat-ai'),
    ]);

    expect(() =>
      pairQualifiers(candidates, scriptedRandom([0, 0, 0])),
    ).not.toThrow();
    expect(candidates.map((entry) => entry.launchId)).toEqual([
      'A1',
      'A2',
      'A3',
    ]);
  });
});

describe('createUniformRandomSource', () => {
  test('32ビットの値を剰余で0〜exclusiveMax−1にする', () => {
    const values = [0, 1, 2, 3, 7, UINT32_RANGE - 3];
    const random = createUniformRandomSource(() => values.shift() ?? 0);

    expect([
      random.nextInt(3),
      random.nextInt(3),
      random.nextInt(3),
      random.nextInt(3),
      random.nextInt(5),
      random.nextInt(2),
    ]).toEqual([0, 1, 2, 0, 2, 1]);
  });

  test('剰余で偏る末尾の範囲の値を捨てて引き直す(棄却法)', () => {
    // 2^32を3で割った余りは1のため、最大の値の2^32−1だけを捨てる
    const values = [UINT32_RANGE - 1, UINT32_RANGE - 1, UINT32_RANGE - 2];
    let draws = 0;
    const random = createUniformRandomSource(() => {
      draws += 1;
      return values.shift() ?? 0;
    });

    expect(random.nextInt(3)).toBe((UINT32_RANGE - 2) % 3);
    expect(draws).toBe(3);
  });

  test('捨てる範囲の境界の直前の値は捨てない', () => {
    // 2^32を10で割った余りは6のため、2^32−6以上を捨て、2^32−7は受け入れる
    const values = [UINT32_RANGE - 6, UINT32_RANGE - 7];
    let draws = 0;
    const random = createUniformRandomSource(() => {
      draws += 1;
      return values.shift() ?? 0;
    });

    expect(random.nextInt(10)).toBe((UINT32_RANGE - 7) % 10);
    expect(draws).toBe(2);
  });

  test('2^32で割り切れる範囲は値を捨てない', () => {
    const random = createUniformRandomSource(() => UINT32_RANGE - 1);

    expect(random.nextInt(2)).toBe(1);
    expect(random.nextInt(UINT32_RANGE)).toBe(UINT32_RANGE - 1);
  });

  test('多数の値で範囲の外を返さない', () => {
    let state = 0x9e3779b9;
    const random = createUniformRandomSource(() => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state;
    });

    for (let index = 0; index < 1000; index += 1) {
      const value = random.nextInt(7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  test.each([0, -1, 1.5, Number.NaN, UINT32_RANGE + 1])(
    '範囲の上限%pは例外にする',
    (exclusiveMax) => {
      const random = createUniformRandomSource(() => 0);

      expect(() => random.nextInt(exclusiveMax)).toThrow(RangeError);
    },
  );

  test.each([-1, 1.5, UINT32_RANGE, Number.NaN])(
    '32ビットの符号なし整数でない値%pを引けば例外にする',
    (drawn) => {
      const random = createUniformRandomSource(() => drawn);

      expect(() => random.nextInt(3)).toThrow(RangeError);
    },
  );
});
