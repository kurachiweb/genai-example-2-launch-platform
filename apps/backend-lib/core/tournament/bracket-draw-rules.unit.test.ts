import { describe, expect, test } from 'bun:test';

import { bracketShape } from './bracket-shape.ts';
import {
  type Comparator,
  type DrawCandidate,
  drawBracket,
} from './bracket-draw-rules.ts';

interface Score {
  readonly points: number;
  readonly group: number;
}

const byPointsDescending: Comparator<Score> = (a, b) => b.points - a.points;
const byGroupAscending: Comparator<Score> = (a, b) => a.group - b.group;
const ORDER = { seed: byPointsDescending, nonSeed: byGroupAscending } as const;

function candidate(
  ref: string,
  tieBreaker: string,
  value: Score,
): DrawCandidate<Score> {
  return { ref, tieBreaker, value };
}

function numbering(
  result: ReturnType<typeof drawBracket>,
): readonly (readonly [string, number])[] {
  return result.participants.map(
    ({ ref, participantNo }) => [ref, participantNo] as const,
  );
}

const FIVE_CANDIDATES = [
  candidate('p1', '01JD0PR0D00000000000000001', { points: 10, group: 3 }),
  candidate('p2', '01JD0PR0D00000000000000002', { points: 50, group: 2 }),
  candidate('p3', '01JD0PR0D00000000000000003', { points: 30, group: 1 }),
  candidate('p4', '01JD0PR0D00000000000000004', { points: 40, group: 5 }),
  candidate('p5', '01JD0PR0D00000000000000005', { points: 20, group: 4 }),
] as const;

describe('drawBracket', () => {
  test('参加数0は形だけを返し参加者は空である', () => {
    expect(drawBracket([], ORDER)).toEqual({
      shape: bracketShape(0),
      participants: [],
    });
  });

  test('参加数1は1番の参加者だけを返す', () => {
    const result = drawBracket(
      [
        candidate('only', '01JD0PR0D00000000000000001', {
          points: 0,
          group: 0,
        }),
      ],
      ORDER,
    );
    expect(result.shape).toEqual(bracketShape(1));
    expect(numbering(result)).toEqual([['only', 1]]);
  });

  test('参加数2はシードを設けず非シードの順で1番と2番にする', () => {
    const result = drawBracket(
      [
        candidate('late', '01JD0PR0D00000000000000001', {
          points: 99,
          group: 2,
        }),
        candidate('early', '01JD0PR0D00000000000000002', {
          points: 1,
          group: 1,
        }),
      ],
      ORDER,
    );
    expect(result.shape.seedCount).toBe(0);
    expect(numbering(result)).toEqual([
      ['early', 1],
      ['late', 2],
    ]);
  });

  test('シードの比較で上位S個を1〜S番、残りを非シードの比較でS+1〜N番にする', () => {
    const result = drawBracket(FIVE_CANDIDATES, ORDER);
    expect(result.shape).toEqual(bracketShape(5));
    expect(numbering(result)).toEqual([
      ['p2', 1],
      ['p4', 2],
      ['p3', 3],
      ['p1', 4],
      ['p5', 5],
    ]);
  });

  test('比較が同順ならtieBreakerの昇順に並べる', () => {
    const tied = { points: 7, group: 7 };
    const result = drawBracket(
      [
        candidate('c', '01JD0PR0D00000000000000003', tied),
        candidate('a', '01JD0PR0D00000000000000001', tied),
        candidate('d', '01JD0PR0D00000000000000004', tied),
        candidate('b', '01JD0PR0D00000000000000002', tied),
        candidate('e', '01JD0PR0D00000000000000005', tied),
      ],
      ORDER,
    );
    expect(numbering(result)).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
      ['e', 5],
    ]);
  });

  test('tieBreakerも同じならrefの昇順に並べる', () => {
    const tied = { points: 1, group: 1 };
    const sameKey = '01JD0PR0D00000000000000001';
    const result = drawBracket(
      [
        candidate('b', sameKey, tied),
        candidate('a', sameKey, tied),
        candidate('c', sameKey, tied),
      ],
      ORDER,
    );
    expect(numbering(result)).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  test('tieBreakerは文字列の符号単位の昇順で比べる', () => {
    const tied = { points: 1, group: 1 };
    const result = drawBracket(
      [
        candidate('lower', '01JD0PR0D0000000000000000a', tied),
        candidate('upper', '01JD0PR0D0000000000000000Z', tied),
      ],
      ORDER,
    );
    expect(numbering(result)).toEqual([
      ['upper', 1],
      ['lower', 2],
    ]);
  });

  test('同じ入力からは常に同じ番号を返し、候補の並びに依存しない', () => {
    const first = drawBracket(FIVE_CANDIDATES, ORDER);
    const second = drawBracket(FIVE_CANDIDATES, ORDER);
    const reversed = drawBracket([...FIVE_CANDIDATES].reverse(), ORDER);
    expect(second).toEqual(first);
    expect(reversed).toEqual(first);
  });

  test('比較を差し替えると並びが変わる', () => {
    const swapped = drawBracket(FIVE_CANDIDATES, {
      seed: byGroupAscending,
      nonSeed: byPointsDescending,
    });
    expect(numbering(swapped)).toEqual([
      ['p3', 1],
      ['p2', 2],
      ['p1', 3],
      ['p4', 4],
      ['p5', 5],
    ]);
    expect(numbering(swapped)).not.toEqual(
      numbering(drawBracket(FIVE_CANDIDATES, ORDER)),
    );
  });

  test('候補の値と比較の型は呼び出し元が決める', () => {
    const result = drawBracket(
      [
        { ref: 'x', tieBreaker: '2', value: 'b' },
        { ref: 'y', tieBreaker: '1', value: 'a' },
        { ref: 'z', tieBreaker: '3', value: 'c' },
      ],
      {
        seed: (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0),
        nonSeed: (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
      },
    );
    expect(numbering(result)).toEqual([
      ['z', 1],
      ['y', 2],
      ['x', 3],
    ]);
  });

  test('引数の候補の配列を並べ替えない', () => {
    const candidates = [...FIVE_CANDIDATES];
    drawBracket(candidates, ORDER);
    expect(candidates).toEqual([...FIVE_CANDIDATES]);
  });

  test('同じrefの候補が重なると例外になる', () => {
    expect(() =>
      drawBracket(
        [
          candidate('dup', '01JD0PR0D00000000000000001', {
            points: 1,
            group: 1,
          }),
          candidate('dup', '01JD0PR0D00000000000000002', {
            points: 2,
            group: 2,
          }),
        ],
        ORDER,
      ),
    ).toThrow(RangeError);
  });
});
