import { describe, expect, test } from 'bun:test';

import type { MatchDecision } from '../../../lib/core/match/match-model.ts';
import { type BoardMatch, orderBoard } from './board-order.ts';

const match = (
  matchId: string,
  overrides: Partial<Omit<BoardMatch, 'matchId'>> = {},
): BoardMatch => ({
  matchId,
  totalUpvotes: 0,
  decision: null,
  endedEarly: false,
  entryCount: 2,
  ...overrides,
});

describe('orderBoard の対戦カードの並び', () => {
  test('合計が最大の1件を先頭に、残りを合計の少ない順に並べる', () => {
    const board = orderBoard([
      match('m1', { totalUpvotes: 5 }),
      match('m2', { totalUpvotes: 21 }),
      match('m3', { totalUpvotes: 0 }),
      match('m4', { totalUpvotes: 12 }),
    ]);

    expect(board.cards).toEqual(['m2', 'm3', 'm1', 'm4']);
  });

  test('合計が最大の側が並ぶときはIDの昇順で最初の1件を先頭にする', () => {
    const board = orderBoard([
      match('m3', { totalUpvotes: 9 }),
      match('m1', { totalUpvotes: 9 }),
      match('m2', { totalUpvotes: 4 }),
    ]);

    expect(board.cards).toEqual(['m1', 'm2', 'm3']);
  });

  test('残りの同数はIDの昇順に並べる', () => {
    const board = orderBoard([
      match('m9', { totalUpvotes: 30 }),
      match('m5', { totalUpvotes: 2 }),
      match('m2', { totalUpvotes: 2 }),
      match('m7', { totalUpvotes: 2 }),
    ]);

    expect(board.cards).toEqual(['m9', 'm2', 'm5', 'm7']);
  });

  test('IDはロケールに依らず文字の符号の順で比べる', () => {
    const board = orderBoard([
      match('01JB', { totalUpvotes: 1 }),
      match('01Ja', { totalUpvotes: 1 }),
      match('01JA', { totalUpvotes: 1 }),
    ]);

    expect(board.cards).toEqual(['01JA', '01JB', '01Ja']);
  });

  test('全てが0票ならIDの昇順になる', () => {
    const board = orderBoard([match('m2'), match('m3'), match('m1')]);

    expect(board.cards).toEqual(['m1', 'm2', 'm3']);
  });

  test.each(['votes', 'last_upvote', 'no_votes'] as const)(
    '終了の日時で%sに確定したマッチも対戦カードに残す',
    (decision) => {
      const board = orderBoard([
        match('m1', { totalUpvotes: 3, decision }),
        match('m2', { totalUpvotes: 8 }),
      ]);

      expect(board.cards).toEqual(['m2', 'm1']);
      expect(board.byes).toEqual([]);
    },
  );

  test('マッチが無ければ全てが空で実施数は0', () => {
    expect(orderBoard([])).toEqual({ cards: [], byes: [], heldCount: 0 });
  });

  test('入力の配列を並べ替えない', () => {
    const input = [
      match('m2', { totalUpvotes: 1 }),
      match('m1', { totalUpvotes: 7 }),
    ];

    orderBoard(input);

    expect(input.map((item) => item.matchId)).toEqual(['m2', 'm1']);
  });
});

describe('orderBoard の不戦勝の分類', () => {
  test('対戦相手がいない不戦勝は対戦相手なしに分類する', () => {
    const board = orderBoard([match('m1', { decision: 'bye', entryCount: 1 })]);

    expect(board.cards).toEqual([]);
    expect(board.byes).toEqual([{ matchId: 'm1', reason: 'absent' }]);
  });

  test('開始の記録の前の側が1つのマッチも対戦相手なしに分類する', () => {
    const board = orderBoard([match('m1', { entryCount: 1 })]);

    expect(board.cards).toEqual([]);
    expect(board.byes).toEqual([{ matchId: 'm1', reason: 'absent' }]);
  });

  test('開始時点の相手の該当による不戦勝は相手の該当に分類する', () => {
    const board = orderBoard([match('m1', { decision: 'walkover' })]);

    expect(board.cards).toEqual([]);
    expect(board.byes).toEqual([{ matchId: 'm1', reason: 'forfeit' }]);
  });

  test('即時の終了による不戦勝は即時の終了に分類する', () => {
    const board = orderBoard([
      match('m1', { decision: 'walkover', endedEarly: true, totalUpvotes: 4 }),
    ]);

    expect(board.cards).toEqual([]);
    expect(board.byes).toEqual([{ matchId: 'm1', reason: 'early' }]);
  });

  test('不戦勝はIDの昇順に並べる', () => {
    const board = orderBoard([
      match('m3', { decision: 'walkover', endedEarly: true, totalUpvotes: 9 }),
      match('m1', { decision: 'bye', entryCount: 1 }),
      match('m2', { decision: 'walkover' }),
    ]);

    expect(board.byes).toEqual([
      { matchId: 'm1', reason: 'absent' },
      { matchId: 'm2', reason: 'forfeit' },
      { matchId: 'm3', reason: 'early' },
    ]);
  });

  test.each([
    ['開始時点の両方の該当', { entryCount: 2, endedEarly: false }],
    ['開始時点の唯一の側の該当', { entryCount: 1, endedEarly: false }],
    ['即時の終了での両方の該当', { entryCount: 2, endedEarly: true }],
  ] as const)(
    '%sによる両者敗北は対戦カードにも不戦勝にも出さない',
    (_label, overrides) => {
      const board = orderBoard([
        match('m1', { decision: 'both_forfeited', ...overrides }),
      ]);

      expect(board).toEqual({ cards: [], byes: [], heldCount: 0 });
    },
  );

  test.each(['votes', 'last_upvote', 'no_votes', 'walkover'] as const)(
    '側が1つで%sに確定したマッチは不整合として拒否する',
    (decision: MatchDecision) => {
      expect(() =>
        orderBoard([match('m1', { decision, entryCount: 1 })]),
      ).toThrow(RangeError);
    },
  );
});

describe('orderBoard の実施数', () => {
  test('対戦カードと即時の終了を数え、対戦相手なし・開始時点の相手の該当・両者敗北を数えない', () => {
    const board = orderBoard([
      match('m1', { totalUpvotes: 3 }),
      match('m2', { totalUpvotes: 6, decision: 'votes' }),
      match('m3', { decision: 'walkover', endedEarly: true, totalUpvotes: 2 }),
      match('m4', { decision: 'bye', entryCount: 1 }),
      match('m5', { decision: 'walkover' }),
      match('m6', { decision: 'both_forfeited' }),
    ]);

    expect(board.cards).toEqual(['m2', 'm1']);
    expect(board.heldCount).toBe(3);
  });

  test('不戦勝だけの日の実施数は0', () => {
    const board = orderBoard([
      match('m1', { decision: 'bye', entryCount: 1 }),
      match('m2', { decision: 'walkover' }),
    ]);

    expect(board.heldCount).toBe(0);
  });
});
