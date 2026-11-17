import { describe, expect, test } from 'bun:test';

import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';
import {
  weekBoardOf,
  weekBoardResult,
  weekBoardRoundOf,
  weekByeOf,
  weekMatchOf,
} from './week-board-fixtures.ts';
import {
  canWeekBoardChange,
  isWeekBoardAwaitingChange,
  isWeekFollowUpExhausted,
  splitBoardRound,
  weekBoardRefetchIntervalOf,
  weekSectionRoundsOf,
  withUpdatedWeekBoardMatch,
} from './week-board-model.ts';

const finishedMatchOf = (n: number): MatchFragment =>
  weekMatchOf(n, { phase: 'FINISHED', decision: 'VOTES' });

describe('splitBoardRound', () => {
  test('サーバーが分けた対戦カードと不戦勝を、位置の順のまま分ける', () => {
    const round = weekBoardRoundOf({
      matches: [weekMatchOf(2), weekMatchOf(1)],
      byes: [weekByeOf(3), weekByeOf(4, { endedEarly: true })],
    });

    const split = splitBoardRound(round);

    expect(split.cards.map(({ id }) => id)).toStrictEqual([
      weekMatchOf(2).id,
      weekMatchOf(1).id,
    ]);
    expect(split.byes.map(({ match }) => match.id)).toStrictEqual([
      weekByeOf(3).match.id,
      weekByeOf(4).match.id,
    ]);
    expect(split.final).toBe(false);
  });

  test('決勝のラウンドの行を決勝と判定する', () => {
    const round = weekBoardRoundOf({
      round: 3,
      roundName: '決勝',
      final: true,
      matches: [weekMatchOf(1, { round: 3, stage: 'FINAL' })],
    });

    expect(splitBoardRound(round).final).toBe(true);
  });
});

describe('weekSectionRoundsOf', () => {
  test('決勝の行と、対戦カードも不戦勝も無い行(全てが両者の不戦敗)を除き、サーバーの順(1回戦の日の昇順)を保つ', () => {
    const earlier = weekBoardRoundOf({ round: 5, roundName: '準々決勝' });
    const later = weekBoardRoundOf({
      tournament: {
        ...weekBoardRoundOf().tournament,
        week: '2026-W47',
        label: '2026年第47週(11/16〜11/22)',
      },
      round: 1,
      matches: [],
      byes: [weekByeOf(1)],
    });
    const forfeited = weekBoardRoundOf({ round: 2, matches: [], byes: [] });
    const final = weekBoardRoundOf({ round: 3, final: true });

    const rounds = weekSectionRoundsOf([earlier, final, forfeited, later]);

    expect(rounds.map(({ round }) => round.round)).toStrictEqual([5, 1]);
    expect(rounds[1]?.byes).toHaveLength(1);
  });

  test('その日にマッチが無ければ空にする', () => {
    expect(weekSectionRoundsOf([])).toStrictEqual([]);
  });
});

describe('Weekトーナメントの区画の定期の取り直し', () => {
  test('決勝以外の行に確定の前の対戦カードがある間だけ、変わり得ると判定する', () => {
    expect(canWeekBoardChange(weekBoardOf())).toBe(true);
    expect(
      canWeekBoardChange(
        weekBoardOf({
          rounds: [
            weekBoardRoundOf({
              matches: [weekMatchOf(1, { phase: 'TALLYING' })],
            }),
          ],
        }),
      ),
    ).toBe(true);
    expect(
      canWeekBoardChange(
        weekBoardOf({
          rounds: [weekBoardRoundOf({ matches: [finishedMatchOf(1)] })],
        }),
      ),
    ).toBe(false);
    expect(
      canWeekBoardChange(
        weekBoardOf({ rounds: [weekBoardRoundOf({ final: true })] }),
      ),
    ).toBe(false);
    expect(
      canWeekBoardChange(
        weekBoardOf({
          rounds: [weekBoardRoundOf({ matches: [], byes: [weekByeOf(1)] })],
        }),
      ),
    ).toBe(false);
    expect(canWeekBoardChange(undefined)).toBe(false);
  });

  const boardWith = (phases: readonly MatchFragment['phase'][]) =>
    weekBoardOf({
      rounds: [
        weekBoardRoundOf({
          matches: phases.map((phase, index) =>
            weekMatchOf(index + 1, { phase }),
          ),
        }),
      ],
    });

  test('集計中か開始の前の対戦カードがあれば、結果か開始を待っていると判定する', () => {
    expect(isWeekBoardAwaitingChange(boardWith(['LIVE', 'TALLYING']))).toBe(
      true,
    );
    expect(isWeekBoardAwaitingChange(boardWith(['SCHEDULED']))).toBe(true);
    expect(isWeekBoardAwaitingChange(boardWith(['LIVE', 'FINISHED']))).toBe(
      false,
    );
    expect(isWeekBoardAwaitingChange(undefined)).toBe(false);
  });

  test('自動更新がオンで変わり得る間は定期再取得の間隔を返し、確定の後と取得の前は止める', () => {
    for (const phases of [['LIVE'], ['TALLYING'], ['SCHEDULED']] as const) {
      expect(
        weekBoardRefetchIntervalOf({
          board: boardWith(phases),
          autoRefresh: true,
          updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
        }),
      ).toBe(LIVE_REFRESH_INTERVAL_MS);
    }
    expect(
      weekBoardRefetchIntervalOf({
        board: boardWith(['FINISHED']),
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
    expect(
      weekBoardRefetchIntervalOf({
        board: undefined,
        autoRefresh: true,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
  });

  test('自動更新がオフの間は、マッチ中は止め、結果か開始を待つ間だけ上限の回数まで取り直す', () => {
    expect(
      weekBoardRefetchIntervalOf({
        board: boardWith(['LIVE']),
        autoRefresh: false,
        updatesSinceBaseline: 0,
      }),
    ).toBe(false);
    expect(
      weekBoardRefetchIntervalOf({
        board: boardWith(['TALLYING']),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT - 1,
      }),
    ).toBe(LIVE_REFRESH_INTERVAL_MS);
    expect(
      weekBoardRefetchIntervalOf({
        board: boardWith(['SCHEDULED']),
        autoRefresh: false,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
      }),
    ).toBe(false);
  });

  test('結果か開始を待つ取り直しが、自動更新がオフのまま上限に達した時だけ、開き直しの案内を出すと判定する', () => {
    const input = {
      board: boardWith(['TALLYING']),
      autoRefresh: false,
      updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT,
    };
    expect(isWeekFollowUpExhausted(input)).toBe(true);
    expect(isWeekFollowUpExhausted({ ...input, autoRefresh: true })).toBe(
      false,
    );
    expect(
      isWeekFollowUpExhausted({
        ...input,
        updatesSinceBaseline: FOLLOW_UP_REFETCH_LIMIT - 1,
      }),
    ).toBe(false);
    expect(
      isWeekFollowUpExhausted({ ...input, board: boardWith(['FINISHED']) }),
    ).toBe(false);
  });
});

describe('withUpdatedWeekBoardMatch', () => {
  test('Upvoteの結果のマッチを、取り直さずに同じ行の同じ位置で差し替える', () => {
    const data = weekBoardResult(
      weekBoardOf({
        rounds: [
          weekBoardRoundOf(),
          weekBoardRoundOf({ round: 2, matches: [weekMatchOf(3)] }),
        ],
      }),
    ).data;
    const updated = weekMatchOf(2, { viewerUpvotedEntryId: 'updated' });

    const next = withUpdatedWeekBoardMatch(data, updated);

    expect(next?.weekTournamentBoard.rounds[0]?.matches).toStrictEqual([
      weekMatchOf(1),
      updated,
    ]);
    expect(next?.weekTournamentBoard.rounds[1]).toBe(
      data.weekTournamentBoard.rounds[1],
    );
  });

  test('盤面に無いマッチと取得の前の値は、そのまま返す', () => {
    const data = weekBoardResult().data;

    expect(withUpdatedWeekBoardMatch(data, weekMatchOf(9))).toBe(data);
    expect(withUpdatedWeekBoardMatch(undefined, weekMatchOf(1))).toBe(
      undefined,
    );
  });
});
