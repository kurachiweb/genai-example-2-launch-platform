import { describe, expect, test } from 'bun:test';

import {
  roundLabel,
  stageForSlotCount,
  TOURNAMENT_STAGES,
  type TournamentStage,
  tournamentRoundName,
} from './round-name.ts';

describe('stageForSlotCount', () => {
  test.each([
    [8, 'quarterfinal'],
    [4, 'semifinal'],
    [2, 'final'],
  ] as const)('残り参加数%iの段階は%sである', (slotCount, expected) => {
    expect(stageForSlotCount(slotCount)).toBe(expected);
  });

  test.each([0, 1, 3, 5, 6, 7, 13, 16, 2.5, -2])(
    '残り参加数%pは段階を持たない',
    (slotCount) => {
      expect(stageForSlotCount(slotCount)).toBeNull();
    },
  );

  test('段階の値は早いラウンドから順に並ぶ', () => {
    expect(TOURNAMENT_STAGES).toEqual(['quarterfinal', 'semifinal', 'final']);
    expect(Object.isFrozen(TOURNAMENT_STAGES)).toBe(true);
  });
});

describe('roundLabel', () => {
  test.each([
    [{ round: 2, stage: 'quarterfinal' }, '準々決勝'],
    [{ round: 3, stage: 'semifinal' }, '準決勝'],
    [{ round: 4, stage: 'final' }, '決勝'],
    [{ round: null, stage: 'final' }, '決勝'],
  ] as const satisfies readonly (readonly [
    { readonly round: number | null; readonly stage: TournamentStage | null },
    string,
  ])[])('段階を持つ%oは段階の名前%sにする', (input, expected) => {
    expect(roundLabel(input)).toBe(expected);
  });

  test.each([
    [1, '1回戦'],
    [2, '2回戦'],
    [10, '10回戦'],
  ])('段階を持たないラウンド%iは%sにする', (round, expected) => {
    expect(roundLabel({ round, stage: null })).toBe(expected);
  });

  test.each([null, 0, -1, 1.5])(
    '段階が無くラウンド%pが正の整数でなければnullにする',
    (round) => {
      expect(roundLabel({ round, stage: null })).toBeNull();
    },
  );
});

describe('tournamentRoundName', () => {
  test.each([
    [3, [3, 2], ['1回戦', '決勝']],
    [4, [4, 2], ['準決勝', '決勝']],
    [8, [8, 4, 2], ['準々決勝', '準決勝', '決勝']],
    [13, [13, 8, 4, 2], ['1回戦', '準々決勝', '準決勝', '決勝']],
  ] as const)(
    '参加数%iの各ラウンドの残り参加数%oのラウンド名は%oである',
    (_participantCount, slotCounts, expected) => {
      const names = slotCounts.map((slotCount, index) =>
        tournamentRoundName({ round: index + 1, slotCount }),
      );

      expect(names).toEqual([...expected]);
    },
  );

  test('残り参加数が段階を持たずラウンドも正の整数でなければRangeErrorにする', () => {
    expect(() => tournamentRoundName({ round: 0, slotCount: 13 })).toThrow(
      RangeError,
    );
  });
});
