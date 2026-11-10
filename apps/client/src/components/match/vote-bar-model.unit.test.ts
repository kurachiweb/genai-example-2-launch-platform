import { describe, expect, test } from 'bun:test';

import {
  BALL_FLIGHT_MS,
  BALL_HOLD_MS,
  BALL_RETURN_MS,
  ballPositionOf,
  ballTransitionOf,
  voteShareOf,
} from './vote-bar-model.ts';

describe('voteShareOf', () => {
  test('左の側のUpvote数の比率を返す', () => {
    expect(voteShareOf(12, 9)).toStrictEqual({
      isEmpty: false,
      leftRatio: 12 / 21,
    });
    expect(voteShareOf(0, 3)).toStrictEqual({ isEmpty: false, leftRatio: 0 });
  });

  test('0対0は空のバーにし、ボールを中央に置く', () => {
    expect(voteShareOf(0, 0)).toStrictEqual({ isEmpty: true, leftRatio: 0.5 });
  });
});

describe('ballPositionOf', () => {
  test('演出が無ければ比率の境目に置く', () => {
    expect(ballPositionOf(null, 0.3)).toBe(0.3);
  });

  test.each(['flying', 'holding'] as const)(
    'ボールが%sの間は飛び込む側のゴールに置く',
    (phase) => {
      expect(ballPositionOf({ target: 'left', phase }, 0.3)).toBe(0);
      expect(ballPositionOf({ target: 'right', phase }, 0.3)).toBe(1);
    },
  );

  test('戻る間は比率の境目へ向かう', () => {
    expect(ballPositionOf({ target: 'right', phase: 'returning' }, 0.3)).toBe(
      0.3,
    );
  });
});

describe('ballTransitionOf', () => {
  test('戻る間はゆっくり戻り、それ以外は素早く飛ぶ', () => {
    expect(
      ballTransitionOf({ target: 'left', phase: 'returning' }),
    ).toStrictEqual({
      durationMs: BALL_RETURN_MS,
      easing: 'cubic-bezier(0.45, 0, 0.2, 1)',
    });
    expect(ballTransitionOf({ target: 'left', phase: 'flying' })).toStrictEqual(
      {
        durationMs: BALL_FLIGHT_MS,
        easing: 'cubic-bezier(0.5, 0, 1, 1)',
      },
    );
    expect(ballTransitionOf(null).durationMs).toBe(BALL_FLIGHT_MS);
  });

  test('演出の各段階の時間はデザイン案と同じにする', () => {
    expect([BALL_FLIGHT_MS, BALL_HOLD_MS, BALL_RETURN_MS]).toStrictEqual([
      400, 1000, 2500,
    ]);
  });
});
