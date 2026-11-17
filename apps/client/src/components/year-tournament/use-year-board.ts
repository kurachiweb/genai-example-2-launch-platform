import { useMemo } from 'react';

import type {
  ClientYearTournamentBoardQuery,
  MatchFragment,
  YearBoardRoundFieldsFragment,
} from '../../graphql/generated/graphql.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { yearTournamentBoardQueryOptions } from '../../graphql/year-tournament.ts';
import type { TopPageSectionContext } from '../top/top-page-section-types.ts';
import {
  type TournamentBoardAccess,
  type TournamentBoardRefreshInput,
  withUpdatedBoardMatch,
} from '../tournament/tournament-board-model.ts';
import { useTournamentBoard } from '../tournament/use-tournament-board.ts';

export type YearBoard = ClientYearTournamentBoardQuery['yearTournamentBoard'];

export interface UseYearBoardInput {
  readonly board: TopPageSectionContext['board'];
  readonly clientViewer: ClientViewer | null;
  readonly autoRefresh: boolean;
  // 区画が描く行の状態から、定期の取り直しの間隔を決める
  readonly refetchIntervalOf: (
    input: TournamentBoardRefreshInput,
  ) => number | false;
  // 区画が描く行が変わり得る間だけ、画面へ戻った時に取り直す
  readonly canChange: (
    rounds: readonly YearBoardRoundFieldsFragment[] | undefined,
  ) => boolean;
}

export interface YearBoardSubscription {
  readonly yearBoard: YearBoard;
  // ページを表示した時点と最後の境界の時刻のうち後の時点からの、取得の更新の回数
  readonly updatesSinceBaseline: number;
  // Upvote・取り消しの成功でサーバーが返したマッチを、取り直さずに盤面へ反映する
  readonly onUpdated: (match: MatchFragment) => void;
}

const YEAR_BOARD_ACCESS: TournamentBoardAccess<
  ClientYearTournamentBoardQuery,
  YearBoardRoundFieldsFragment
> = Object.freeze({
  roundsOf: (data: ClientYearTournamentBoardQuery) =>
    data.yearTournamentBoard.rounds,
  withRounds: (
    data: ClientYearTournamentBoardQuery,
    rounds: readonly YearBoardRoundFieldsFragment[],
  ): ClientYearTournamentBoardQuery => ({
    ...data,
    yearTournamentBoard: { ...data.yearTournamentBoard, rounds: [...rounds] },
  }),
});

const withUpdatedYearBoardMatch = (
  data: ClientYearTournamentBoardQuery | undefined,
  match: MatchFragment,
): ClientYearTournamentBoardQuery | undefined =>
  withUpdatedBoardMatch(data, match, YEAR_BOARD_ACCESS);

// トップページのYearトーナメントの区画(本文の行と決勝の注目)が共有する、当日の業務日付のYearの盤面の購読
export function useYearBoard({
  board,
  clientViewer,
  autoRefresh,
  refetchIntervalOf,
  canChange,
}: UseYearBoardInput): YearBoardSubscription {
  const queryOptions = useMemo(
    () => yearTournamentBoardQueryOptions(clientViewer, board.date),
    [clientViewer, board.date],
  );
  const { data, updatesSinceBaseline, onUpdated } = useTournamentBoard({
    clientViewer,
    autoRefresh,
    queryOptions,
    roundsOf: YEAR_BOARD_ACCESS.roundsOf,
    withUpdatedMatch: withUpdatedYearBoardMatch,
    refetchIntervalOf,
    canChange,
  });
  return {
    yearBoard: data.yearTournamentBoard,
    updatesSinceBaseline,
    onUpdated,
  };
}
