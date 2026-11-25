import { describe, expect, test } from 'bun:test';

import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';
import {
  boardByeOf,
  boardMatchOf,
  type BoardRoundFixture,
  boardRoundOf,
} from './tournament-board-fixtures.ts';
import {
  boardRefetchIntervalOf,
  canBoardChange,
  isBoardAwaitingChange,
  isBoardFollowUpExhausted,
  sectionRoundsOf,
  splitBoardRound,
  type TournamentBoardAccess,
  withUpdatedBoardMatch,
} from './tournament-board-model.ts';

// 種類の照会の結果の代わりに、盤面の下に行を持つ値
interface BoardFixtureData {
  readonly board: { readonly rounds: readonly BoardRoundFixture[] };
}

const BOARD_FIXTURE_ACCESS: TournamentBoardAccess<
  BoardFixtureData,
  BoardRoundFixture
> = Object.freeze({
  roundsOf: (data: BoardFixtureData) => data.board.rounds,
  withRounds: (
    data: BoardFixtureData,
    rounds: readonly BoardRoundFixture[],
  ): BoardFixtureData => ({ ...data, board: { ...data.board, rounds } }),
});

const boardDataOf = (
  rounds: readonly BoardRoundFixture[] = [boardRoundOf()],
): BoardFixtureData => ({ board: { rounds } });

const finishedMatchOf = (n: number): MatchFragment =>
  boardMatchOf(n, { phase: 'FINISHED', decision: 'VOTES' });

describe('splitBoardRound', () => {
  test('サーバーが分けた対戦カードと不戦勝を、位置の順のまま分ける', () => {
    const round = boardRoundOf({
      matches: [boardMatchOf(2), boardMatchOf(1)],
      byes: [boardByeOf(3), boardByeOf(4, { endedEarly: true })],
    });

    const split = splitBoardRound(round);

    expect(split.cards.map(({ id }) => id)).toStrictEqual([
      boardMatchOf(2).id,
      boardMatchOf(1).id,
    ]);
    expect(split.byes.map(({ match }) => match.id)).toStrictEqual([
      boardByeOf(3).match.id,
      boardByeOf(4).match.id,
    ]);
    expect(split.final).toBe(false);
  });

  test('決勝のラウンドの行を決勝と判定する', () => {
    const round = boardRoundOf({
      round: 3,
      roundName: '決勝',
      final: true,
      matches: [boardMatchOf(1, { round: 3, stage: 'FINAL' })],
    });

    expect(splitBoardRound(round).final).toBe(true);
  });
});

describe('sectionRoundsOf', () => {
  test('決勝の行と、対戦カードも不戦勝も無い行(全てが両者の不戦敗)を除き、サーバーの順(1回戦の日の昇順)を保つ', () => {
    const earlier = boardRoundOf({ round: 5, roundName: '準々決勝' });
    const later = boardRoundOf({
      key: 'later',
      periodLabel: '2026年第47週(11/16〜11/22)',
      round: 1,
      matches: [],
      byes: [boardByeOf(1)],
    });
    const forfeited = boardRoundOf({ round: 2, matches: [], byes: [] });
    const final = boardRoundOf({ round: 3, final: true });

    const rounds = sectionRoundsOf([earlier, final, forfeited, later]);

    expect(rounds.map(({ round }) => round.round)).toStrictEqual([5, 1]);
    expect(rounds[1]?.round).toBe(later);
    expect(rounds[1]?.byes).toHaveLength(1);
  });

  test('その日にマッチが無ければ空にする', () => {
    expect(sectionRoundsOf([])).toStrictEqual([]);
  });
});

describe('トーナメントの区画の定期の取り直し', () => {
  test('決勝以外の行に確定の前の対戦カードがある間だけ、変わり得ると判定する', () => {
    expect(canBoardChange([boardRoundOf()])).toBe(true);
    expect(
      canBoardChange([
        boardRoundOf({ matches: [boardMatchOf(1, { phase: 'TALLYING' })] }),
      ]),
    ).toBe(true);
    expect(
      canBoardChange([boardRoundOf({ matches: [finishedMatchOf(1)] })]),
    ).toBe(false);
    expect(canBoardChange([boardRoundOf({ final: true })])).toBe(false);
    expect(
      canBoardChange([boardRoundOf({ matches: [], byes: [boardByeOf(1)] })]),
    ).toBe(false);
    expect(canBoardChange(undefined)).toBe(false);
  });

  const roundsWith = (phases: readonly MatchFragment['phase'][]) => [
    boardRoundOf({
      matches: phases.map((phase, index) => boardMatchOf(index + 1, { phase })),
    }),
  ];

  test('集計中か開始の前の対戦カードがあれば、結果か開始を待っていると判定する', () => {
    expect(isBoardAwaitingChange(roundsWith(['LIVE', 'TALLYING']))).toBe(true);
    expect(isBoardAwaitingChange(roundsWith(['SCHEDULED']))).toBe(true);
    expect(isBoardAwaitingChange(roundsWith(['LIVE', 'FINISHED']))).toBe(false);
    expect(isBoardAwaitingChange(undefined)).toBe(false);
  });

  test('自動更新がオンで変わり得る間は定期再取得の間隔を返し、確定の後と取得の前は止める', () => {
    for (const phases of [['LIVE'], ['TALLYING'], ['SCHEDULED']] as const) {
      expect(
        boardRefetchIntervalOf({
          rounds: roundsWith(phases),
          autoRefresh: true,
          updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
        }),
      ).toBe(LIVE_REFRESH_INTERVAL_MS);
    }
    expect(
      boardRefetchIntervalOf({
        rounds: roundsWith(['FINISHED']),
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
    expect(
      boardRefetchIntervalOf({
        rounds: undefined,
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
  });

  test('自動更新がオフの間は、マッチ中は止め、結果か開始を待つ間だけ上限の回数まで取り直す', () => {
    expect(
      boardRefetchIntervalOf({
        rounds: roundsWith(['LIVE']),
        autoRefresh: false,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
    expect(
      boardRefetchIntervalOf({
        rounds: roundsWith(['TALLYING']),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT - 1,
      }),
    ).toBe(LIVE_REFRESH_INTERVAL_MS);
    expect(
      boardRefetchIntervalOf({
        rounds: roundsWith(['SCHEDULED']),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
      }),
    ).toBe(false);
  });

  test('結果か開始を待つ取り直しが、自動更新がオフのまま上限に達した時だけ、開き直しの案内を出すと判定する', () => {
    const input = {
      rounds: roundsWith(['TALLYING']),
      autoRefresh: false,
      updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
    };
    expect(isBoardFollowUpExhausted(input)).toBe(true);
    expect(isBoardFollowUpExhausted({ ...input, autoRefresh: true })).toBe(
      false,
    );
    expect(
      isBoardFollowUpExhausted({
        ...input,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT - 1,
      }),
    ).toBe(false);
    expect(
      isBoardFollowUpExhausted({ ...input, rounds: roundsWith(['FINISHED']) }),
    ).toBe(false);
  });
});

describe('withUpdatedBoardMatch', () => {
  test('Upvoteの結果のマッチを、取り直さずに同じ行の同じ位置で差し替える', () => {
    const data = boardDataOf([
      boardRoundOf(),
      boardRoundOf({ round: 2, matches: [boardMatchOf(3)] }),
    ]);
    const updated = boardMatchOf(2, { viewerUpvotedEntryId: 'updated' });

    const next = withUpdatedBoardMatch(data, updated, BOARD_FIXTURE_ACCESS);

    expect(next?.board.rounds[0]?.matches).toStrictEqual([
      boardMatchOf(1),
      updated,
    ]);
    expect(next?.board.rounds[1]).toBe(data.board.rounds[1]);
  });

  test('盤面に無いマッチと取得の前の値は、そのまま返す', () => {
    const data = boardDataOf();

    expect(
      withUpdatedBoardMatch(data, boardMatchOf(9), BOARD_FIXTURE_ACCESS),
    ).toBe(data);
    expect(
      withUpdatedBoardMatch(undefined, boardMatchOf(1), BOARD_FIXTURE_ACCESS),
    ).toBe(undefined);
  });
});
