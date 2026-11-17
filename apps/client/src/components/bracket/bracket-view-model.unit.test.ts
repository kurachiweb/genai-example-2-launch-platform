import { describe, expect, test } from 'bun:test';

import {
  bracketMatchOf,
  bracketNodeOf,
  bracketProductOf,
  bracketRoundOf,
  EMPTY_BRACKET_SLOT,
  feedSlotOf,
  IN_PROGRESS_ROUNDS,
  playedSlotOf,
} from './bracket-fixtures.ts';
import type { BracketViewMatch } from './bracket-view-props.ts';
import {
  championStateOf,
  defaultRoundOf,
  matchStatusOf,
  slotDisplayOf,
  slotOutcomeOf,
} from './bracket-view-model.ts';

const finishedRound = (round: number, name: string) =>
  bracketRoundOf(round, name, '2026-11-10', [
    bracketNodeOf(
      1,
      bracketMatchOf(round, { phase: 'FINISHED', decision: 'VOTES' }),
      [playedSlotOf(1, { result: 'WON' }), playedSlotOf(2, { result: 'LOST' })],
    ),
  ]);

describe('slotDisplayOf', () => {
  const played = bracketMatchOf(1);

  test('未来の枠の表記があれば、抽選番号が決まっていても表記を示す', () => {
    expect(
      slotDisplayOf(
        bracketNodeOf(1, null, [
          feedSlotOf('シード3', { participantNo: 3, seed: 3 }),
          EMPTY_BRACKET_SLOT,
        ]),
        feedSlotOf('シード3', { participantNo: 3, seed: 3 }),
      ),
    ).toStrictEqual({ kind: 'feed', label: 'シード3' });
  });

  test('抽選番号も表記も無い枠は空', () => {
    expect(
      slotDisplayOf(
        bracketNodeOf(1, played, [playedSlotOf(1), EMPTY_BRACKET_SLOT]),
        EMPTY_BRACKET_SLOT,
      ),
    ).toStrictEqual({ kind: 'empty' });
  });

  test('マッチの無い位置の表記の無い枠は抽選番号だけを示す', () => {
    const slot = playedSlotOf(7, { product: null, upvoteCount: null });

    expect(
      slotDisplayOf(bracketNodeOf(1, null, [slot, slot]), slot),
    ).toStrictEqual({ kind: 'number', participantNo: 7 });
  });

  test('マッチがありプロダクトがnullの枠は表示できないプロダクト', () => {
    const slot = playedSlotOf(4, { product: null });

    expect(
      slotDisplayOf(bracketNodeOf(1, played, [playedSlotOf(3), slot]), slot),
    ).toStrictEqual({ kind: 'hidden' });
  });

  test('マッチがありプロダクトがあればプロダクトを示す', () => {
    const slot = playedSlotOf(3);

    expect(
      slotDisplayOf(bracketNodeOf(1, played, [slot, playedSlotOf(4)]), slot),
    ).toStrictEqual({ kind: 'product', product: bracketProductOf(3) });
  });
});

describe('slotOutcomeOf', () => {
  const outcomesOf = (
    match: Partial<BracketViewMatch>,
    left: Parameters<typeof playedSlotOf>[1],
    right: Parameters<typeof playedSlotOf>[1],
  ) => {
    const slots = [playedSlotOf(1, left), playedSlotOf(2, right)] as const;
    const node = bracketNodeOf(
      1,
      bracketMatchOf(1, { phase: 'FINISHED', ...match }),
      slots,
    );
    return slots.map((slot) => slotOutcomeOf(node, slot));
  };

  test.each([
    ['WON', 'won'],
    ['BYE', 'bye'],
    ['WALKOVER', 'bye'],
  ] as const)('結果%sは%s', (result, expected) => {
    expect(
      outcomesOf({ decision: 'VOTES' }, { result }, { result: 'LOST' }),
    ).toStrictEqual([expected, 'lost']);
  });

  test('相手が勝った敗北は敗北', () => {
    expect(
      outcomesOf(
        { decision: 'LAST_UPVOTE' },
        { result: 'WON' },
        { result: 'LOST' },
      ),
    ).toStrictEqual(['won', 'lost']);
  });

  test.each(['NO_VOTES', 'BOTH_FORFEITED'] as const)(
    '決着の理由が%sの敗北は両者敗北',
    (decision) => {
      expect(
        outcomesOf({ decision }, { result: 'LOST' }, { result: 'LOST' }),
      ).toStrictEqual(['both-lost', 'both-lost']);
    },
  );

  test('結果の無い枠は勝敗を持たない', () => {
    expect(outcomesOf({ phase: 'LIVE' }, {}, {})).toStrictEqual([null, null]);
  });
});

describe('matchStatusOf', () => {
  test('マッチの無い位置は予定', () => {
    expect(
      matchStatusOf(
        bracketNodeOf(1, null, [feedSlotOf('シード1'), feedSlotOf('シード2')]),
      ),
    ).toBe('scheduled');
  });

  test.each([
    ['SCHEDULED', 'scheduled'],
    ['LIVE', 'live'],
    ['TALLYING', 'tallying'],
    ['FINISHED', 'finished'],
  ] as const)('マッチの状態%sは%s', (phase, expected) => {
    expect(
      matchStatusOf(
        bracketNodeOf(1, bracketMatchOf(1, { phase }), [
          playedSlotOf(1),
          playedSlotOf(2),
        ]),
      ),
    ).toBe(expected);
  });
});

describe('defaultRoundOf', () => {
  test('結果の確定していないマッチを持つ最初のラウンド', () => {
    expect(defaultRoundOf(IN_PROGRESS_ROUNDS)).toBe(2);
  });

  test('前のラウンドを終え、予定を作っていない位置だけのラウンドを進行中とみなす', () => {
    expect(
      defaultRoundOf([
        finishedRound(1, '準決勝'),
        bracketRoundOf(2, '決勝', '2026-11-11', [
          bracketNodeOf(1, null, [
            feedSlotOf('準決勝第1試合の勝者', { participantNo: 1 }),
            feedSlotOf('準決勝第2試合の勝者'),
          ]),
        ]),
      ]),
    ).toBe(2);
  });

  test('すべてのマッチの結果が確定していれば最後のラウンド', () => {
    expect(
      defaultRoundOf([finishedRound(1, '準決勝'), finishedRound(2, '決勝')]),
    ).toBe(2);
  });

  test('ラウンドが無ければundefined', () => {
    expect(defaultRoundOf([])).toBeUndefined();
  });
});

describe('championStateOf', () => {
  test('受賞ならプロダクトを示す', () => {
    expect(
      championStateOf({
        champion: bracketProductOf(1),
        awarded: true,
        finished: true,
      }),
    ).toStrictEqual({ kind: 'awarded', product: bracketProductOf(1) });
  });

  test('受賞でプロダクトがnullなら表示できないプロダクトの受賞', () => {
    expect(
      championStateOf({ champion: null, awarded: true, finished: true }),
    ).toStrictEqual({ kind: 'awarded', product: null });
  });

  test('受賞せずに終えたら受賞なし', () => {
    expect(
      championStateOf({ champion: null, awarded: false, finished: true }),
    ).toStrictEqual({ kind: 'no-award' });
  });

  test('終了の前は示さない', () => {
    expect(
      championStateOf({ champion: null, awarded: false, finished: false }),
    ).toBeNull();
  });
});
