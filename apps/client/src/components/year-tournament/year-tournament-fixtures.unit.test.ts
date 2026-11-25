import { describe, expect, test } from 'bun:test';

import {
  YEAR_FINAL_DATE,
  yearBoardOf,
  yearBoardResult,
  yearByeOf,
  yearFinalBoardOf,
  yearFinalRoundOf,
} from './year-tournament-fixtures.ts';

describe('Yearトーナメントのテストの値', () => {
  test('不戦勝は既定で1回戦の不戦勝で、番号ごとに識別と名称が異なる', () => {
    const bye = yearByeOf(3);

    expect(bye.match).toMatchObject({
      kind: 'YEAR',
      round: 1,
      endedEarly: false,
    });
    expect(bye.entry.result).toBe('BYE');
    expect(bye.entry.product?.name).toBe('Year Bye 3');
    expect(yearByeOf(4).entry.id).not.toBe(bye.entry.id);
  });

  test('早期勝利の不戦勝は、ラウンドと票数を受けて結果を早期勝利にする', () => {
    const bye = yearByeOf(1, { endedEarly: true, upvoteCount: 5, round: 2 });

    expect(bye.match).toMatchObject({ round: 2, endedEarly: true });
    expect(bye.entry).toMatchObject({ upvoteCount: 5, result: 'WALKOVER' });
  });

  test('決勝の行は、決勝のラウンドで決勝の対戦カードを持つ', () => {
    const final = yearFinalRoundOf();

    expect(final).toMatchObject({ round: 3, roundName: '決勝', final: true });
    expect(final.matches.map(({ stage }) => stage)).toStrictEqual(['FINAL']);
  });

  test('決勝の日の盤面は、決勝の日付で決勝の行だけを持つ', () => {
    const board = yearFinalBoardOf();

    expect(board.date).toBe(YEAR_FINAL_DATE);
    expect(board.rounds.map(({ final }) => final)).toStrictEqual([true]);
  });

  test('盤面の照会の結果は、成功として盤面を包む', () => {
    const board = yearBoardOf();

    expect(yearBoardResult(board)).toStrictEqual({
      ok: true,
      data: { yearTournamentBoard: board },
    });
    expect(yearBoardResult().data.yearTournamentBoard).toStrictEqual(board);
  });
});
