import { describe, expect, test } from 'bun:test';

import { type BusinessDate, parseBusinessDate } from '../time/business-time.ts';
import {
  type DrawCandidate,
  drawBracket,
} from '../tournament/bracket-draw-rules.ts';
import {
  type WeekOrderingKey,
  weekNonSeedOrder,
  weekSeedOrder,
} from './week-ordering.ts';

const MILLISECONDS_PER_MINUTE = 60_000;
const ORDER = { seed: weekSeedOrder, nonSeed: weekNonSeedOrder } as const;

function elapsed(clock: string): number {
  const [hour = 0, minute = 0] = clock.split(':').map(Number);
  return (hour * 60 + minute) * MILLISECONDS_PER_MINUTE;
}

function key(
  launchDate: string,
  upvoteCount: number,
  lastUpvote: string | null,
): WeekOrderingKey {
  return {
    launchDate: parseBusinessDate(launchDate),
    upvoteCount,
    lastUpvoteElapsedMs: lastUpvote === null ? null : elapsed(lastUpvote),
  };
}

function launchIdOf(index: number): string {
  return `01JD0PR0D00000000000000${String(index).padStart(3, '0')}`;
}

// Weekトーナメント規則の「組み合わせの例(N = 13)」の表
const N13_ROWS = [
  ['A', '2026-09-08', 42, '20:15'],
  ['B', '2026-09-11', 37, '22:01'],
  ['C', '2026-09-07', 37, '14:02'],
  ['D', '2026-09-10', 37, '18:30'],
  ['E', '2026-09-07', 12, '21:40'],
  ['F', '2026-09-07', 9, '10:05'],
  ['G', '2026-09-08', 20, '23:10'],
  ['H', '2026-09-09', 15, '09:47'],
  ['I', '2026-09-10', 8, '16:22'],
  ['J', '2026-09-11', 11, '11:30'],
  ['K', '2026-09-12', 6, '19:55'],
  ['L', '2026-09-13', 30, '13:08'],
  ['M', '2026-09-13', 4, '22:47'],
] as const;

const N13_CANDIDATES: readonly DrawCandidate<WeekOrderingKey>[] = N13_ROWS.map(
  ([ref, launchDate, upvoteCount, lastUpvote], index) => ({
    ref,
    tieBreaker: launchIdOf(index + 1),
    value: key(launchDate, upvoteCount, lastUpvote),
  }),
);

function refsInNumberOrder(
  result: ReturnType<typeof drawBracket>,
): readonly string[] {
  return result.participants.map(({ ref }) => ref);
}

function firstRoundPairs(
  result: ReturnType<typeof drawBracket>,
): readonly (readonly [string, string])[] {
  const { seedCount, firstRoundMatchCount } = result.shape;
  const refByNo = new Map(
    result.participants.map(({ ref, participantNo }) => [participantNo, ref]),
  );
  return Array.from({ length: firstRoundMatchCount }, (_, index) => {
    const position = index + 1;
    return [
      refByNo.get(seedCount + position * 2 - 1) ?? '',
      refByNo.get(seedCount + position * 2) ?? '',
    ] as const;
  });
}

function sortKeys(
  keys: readonly WeekOrderingKey[],
  compare: (a: WeekOrderingKey, b: WeekOrderingKey) => number,
): readonly WeekOrderingKey[] {
  return [...keys].sort(compare);
}

describe('weekSeedOrder', () => {
  test('Upvote数の降順に並べる', () => {
    const many = key('2026-09-13', 42, '23:59');
    const few = key('2026-09-07', 37, '00:01');
    expect(sortKeys([few, many], weekSeedOrder)).toEqual([many, few]);
  });

  test('Upvote数が同じなら最終Upvote時間の昇順に並べ、ローンチ日は見ない', () => {
    const early = key('2026-09-11', 37, '14:02');
    const late = key('2026-09-07', 37, '22:01');
    expect(sortKeys([late, early], weekSeedOrder)).toEqual([early, late]);
  });

  test('最終Upvote時間が無い枠は同じUpvote数の末尾になる', () => {
    const missing = key('2026-09-07', 0, null);
    const present = key('2026-09-13', 0, '23:59');
    expect(sortKeys([missing, present], weekSeedOrder)).toEqual([
      present,
      missing,
    ]);
    expect(weekSeedOrder(missing, present)).toBeGreaterThan(0);
    expect(weekSeedOrder(present, missing)).toBeLessThan(0);
    expect(weekSeedOrder(missing, key('2026-09-13', 0, null))).toBe(0);
  });

  test('全ての項目が同じなら同順を返す', () => {
    expect(
      weekSeedOrder(
        key('2026-09-08', 5, '12:00'),
        key('2026-09-12', 5, '12:00'),
      ),
    ).toBe(0);
  });
});

describe('weekNonSeedOrder', () => {
  test('ローンチ日の昇順をUpvote数より先に見る', () => {
    const earlierDay = key('2026-09-10', 8, '16:22');
    const laterDay = key('2026-09-11', 37, '22:01');
    expect(sortKeys([laterDay, earlierDay], weekNonSeedOrder)).toEqual([
      earlierDay,
      laterDay,
    ]);
  });

  test('同日ならUpvote数の降順、同数なら最終Upvote時間の昇順に並べる', () => {
    const many = key('2026-09-07', 12, '21:40');
    const fewEarly = key('2026-09-07', 9, '10:05');
    const fewLate = key('2026-09-07', 9, '18:00');
    expect(sortKeys([fewLate, fewEarly, many], weekNonSeedOrder)).toEqual([
      many,
      fewEarly,
      fewLate,
    ]);
  });

  test('最終Upvote時間が無い(Upvote数0)の枠は同日の末尾になり、翌日の枠より前に並ぶ', () => {
    const zero = key('2026-09-09', 0, null);
    const sameDay = key('2026-09-09', 1, '23:59');
    const nextDay = key('2026-09-10', 99, '00:01');
    expect(sortKeys([nextDay, zero, sameDay], weekNonSeedOrder)).toEqual([
      sameDay,
      zero,
      nextDay,
    ]);
  });

  test('同日・同数でも最終Upvote時間が無い枠は末尾になる', () => {
    const missing = key('2026-09-09', 0, null);
    const present = key('2026-09-09', 0, '08:00');
    expect(sortKeys([missing, present], weekNonSeedOrder)).toEqual([
      present,
      missing,
    ]);
  });

  test('全ての項目が同じなら同順を返す', () => {
    expect(
      weekNonSeedOrder(key('2026-09-09', 0, null), key('2026-09-09', 0, null)),
    ).toBe(0);
  });
});

describe('Weekの並びによる抽選番号', () => {
  test('N = 13の例でシードはA・C・D、非シードの1回戦はE×F・G×H・I×B・J×K・L×Mになる', () => {
    const result = drawBracket(N13_CANDIDATES, ORDER);

    expect(result.shape.seedCount).toBe(3);
    expect(refsInNumberOrder(result).slice(0, 3)).toEqual(['A', 'C', 'D']);
    expect(refsInNumberOrder(result).slice(3)).toEqual([
      'E',
      'F',
      'G',
      'H',
      'I',
      'B',
      'J',
      'K',
      'L',
      'M',
    ]);
    expect(firstRoundPairs(result)).toEqual([
      ['E', 'F'],
      ['G', 'H'],
      ['I', 'B'],
      ['J', 'K'],
      ['L', 'M'],
    ]);
  });

  test('同じ入力からは候補の並びによらず同じ番号になる', () => {
    const first = drawBracket(N13_CANDIDATES, ORDER);
    expect(drawBracket(N13_CANDIDATES, ORDER)).toEqual(first);
    expect(drawBracket([...N13_CANDIDATES].reverse(), ORDER)).toEqual(first);
  });

  test('Upvote数・最終Upvote時間・ローンチ日が同順ならローンチの識別子の昇順になる', () => {
    const tied = key('2026-09-09', 10, '12:00');
    const result = drawBracket(
      [
        { ref: 'third', tieBreaker: launchIdOf(3), value: tied },
        { ref: 'first', tieBreaker: launchIdOf(1), value: tied },
        { ref: 'fifth', tieBreaker: launchIdOf(5), value: tied },
        { ref: 'second', tieBreaker: launchIdOf(2), value: tied },
        { ref: 'fourth', tieBreaker: launchIdOf(4), value: tied },
      ],
      ORDER,
    );
    expect(result.shape.seedCount).toBe(3);
    expect(refsInNumberOrder(result)).toEqual([
      'first',
      'second',
      'third',
      'fourth',
      'fifth',
    ]);
  });

  test('比較を差し替えると並びが変わる', () => {
    const swapped = drawBracket(N13_CANDIDATES, {
      seed: weekNonSeedOrder,
      nonSeed: weekSeedOrder,
    });
    expect(refsInNumberOrder(swapped)).toEqual([
      'C',
      'E',
      'F',
      'A',
      'D',
      'B',
      'L',
      'G',
      'H',
      'J',
      'I',
      'K',
      'M',
    ]);
  });

  test('ローンチ日は業務日付の文字列で比べる', () => {
    const dates: readonly BusinessDate[] = [
      parseBusinessDate('2026-12-31'),
      parseBusinessDate('2027-01-01'),
    ];
    const result = drawBracket(
      dates.map((launchDate, index) => ({
        ref: launchDate,
        tieBreaker: launchIdOf(index),
        value: { launchDate, upvoteCount: 1, lastUpvoteElapsedMs: 0 },
      })),
      ORDER,
    );
    expect(refsInNumberOrder(result)).toEqual(['2026-12-31', '2027-01-01']);
  });
});
