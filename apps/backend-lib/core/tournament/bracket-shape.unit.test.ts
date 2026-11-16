import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  TOURNAMENT_STAGES,
  type TournamentStage,
  tournamentRoundName,
} from '../../../common-lib/tournament/round-name.ts';
import { MATCH_STAGES, type MatchStage } from '../match/match-model.ts';
import {
  type BracketShape,
  bracketShape,
  roundSlotCount,
  roundStage,
  seedPlacementOrder,
} from './bracket-shape.ts';

function roundsOf(shape: BracketShape): readonly number[] {
  return Array.from({ length: shape.roundCount }, (_, index) => index + 1);
}

describe('bracketShape', () => {
  test.each([
    [0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [2, 1, 0, 1, 1],
    [3, 2, 1, 1, 2],
    [5, 4, 3, 1, 3],
    [6, 4, 2, 2, 3],
    [7, 4, 1, 3, 3],
    [8, 4, 0, 4, 3],
    [13, 8, 3, 5, 4],
    [100, 64, 28, 36, 7],
    [128, 64, 0, 64, 7],
    [129, 128, 127, 1, 8],
    [200, 128, 56, 72, 8],
  ] as const)(
    '参加数%iの2回戦の参加数は%i・シード数は%i・1回戦のマッチ数は%i・ラウンド数は%iである',
    (
      participantCount,
      secondRoundSize,
      seedCount,
      firstRoundMatchCount,
      roundCount,
    ) => {
      expect(bracketShape(participantCount)).toEqual({
        participantCount,
        secondRoundSize,
        seedCount,
        firstRoundMatchCount,
        roundCount,
      });
    },
  );

  test.each([-1, -13, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '参加数%pは0以上の整数でないため例外になる',
    (participantCount) => {
      expect(() => bracketShape(participantCount)).toThrow(RangeError);
    },
  );
});

describe('seedPlacementOrder', () => {
  test.each([
    [1, [1]],
    [2, [1, 2]],
    [4, [1, 4, 2, 3]],
    [8, [1, 8, 4, 5, 2, 7, 3, 6]],
    [16, [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]],
  ] as const)('枠の数%iの配置の列は%pである', (size, expected) => {
    expect(seedPlacementOrder(size)).toEqual(expected);
  });

  test('隣り合う2つの番号の和は列の長さ+1である', () => {
    const order = seedPlacementOrder(64);
    const sums = Array.from(
      { length: order.length / 2 },
      (_, index) => (order[index * 2] ?? 0) + (order[index * 2 + 1] ?? 0),
    );
    expect(new Set(sums)).toEqual(new Set([65]));
    expect([...order].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 64 }, (_, index) => index + 1),
    );
  });

  test.each([0, 3, 6, 12, -4, 2.5])(
    '枠の数%pは2の冪でないため例外になる',
    (size) => {
      expect(() => seedPlacementOrder(size)).toThrow(RangeError);
    },
  );
});

describe('roundSlotCount', () => {
  test.each([
    [2, [2]],
    [3, [3, 2]],
    [8, [8, 4, 2]],
    [13, [13, 8, 4, 2]],
    [129, [129, 128, 64, 32, 16, 8, 4, 2]],
  ] as const)(
    '参加数%iの各ラウンドの残り参加数は%pである',
    (participantCount, expected) => {
      const shape = bracketShape(participantCount);
      expect(
        roundsOf(shape).map((round) => roundSlotCount(shape, round)),
      ).toEqual([...expected]);
    },
  );

  test.each([
    [0, 1],
    [1, 1],
    [13, 0],
    [13, 5],
    [13, 1.5],
    [13, -1],
  ] as const)(
    '参加数%iにラウンド%pは無いため例外になる',
    (participantCount, round) => {
      expect(() =>
        roundSlotCount(bracketShape(participantCount), round),
      ).toThrow(RangeError);
    },
  );
});

describe('roundStage', () => {
  test.each([
    [2, ['final']],
    [3, [null, 'final']],
    [4, ['semifinal', 'final']],
    [8, ['quarterfinal', 'semifinal', 'final']],
    [13, [null, 'quarterfinal', 'semifinal', 'final']],
    [100, [null, null, null, null, 'quarterfinal', 'semifinal', 'final']],
  ] as const)(
    '参加数%iの各ラウンドの段階は%pである',
    (participantCount, expected) => {
      const shape = bracketShape(participantCount);
      expect(roundsOf(shape).map((round) => roundStage(shape, round))).toEqual([
        ...expected,
      ]);
    },
  );

  test('参加数に無いラウンドは例外になる', () => {
    expect(() => roundStage(bracketShape(13), 5)).toThrow(RangeError);
  });

  test('段階の型と値はmatch-engineの段階と一致する', () => {
    expectTypeOf<TournamentStage>().toEqualTypeOf<MatchStage>();
    expectTypeOf<
      ReturnType<typeof roundStage>
    >().toEqualTypeOf<MatchStage | null>();
    expect(TOURNAMENT_STAGES).toEqual(MATCH_STAGES);
  });
});

describe('ラウンド名', () => {
  test.each([
    [3, ['1回戦', '決勝']],
    [4, ['準決勝', '決勝']],
    [8, ['準々決勝', '準決勝', '決勝']],
    [13, ['1回戦', '準々決勝', '準決勝', '決勝']],
  ] as const)(
    '参加数%iの各ラウンドの名前は%pである',
    (participantCount, expected) => {
      const shape = bracketShape(participantCount);
      expect(
        roundsOf(shape).map((round) =>
          tournamentRoundName({
            round,
            slotCount: roundSlotCount(shape, round),
          }),
        ),
      ).toEqual([...expected]);
    },
  );
});
