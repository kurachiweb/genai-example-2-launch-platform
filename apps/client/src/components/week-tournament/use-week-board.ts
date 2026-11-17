import { useMemo } from 'react';

import type {
  ClientWeekTournamentBoardQuery,
  MatchFragment,
  WeekBoardRoundFieldsFragment,
} from '../../graphql/generated/graphql.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { weekTournamentBoardQueryOptions } from '../../graphql/week-tournament.ts';
import type { TopPageSectionContext } from '../top/top-page-section-types.ts';
import {
  type TournamentBoardAccess,
  type TournamentBoardRefreshInput,
  withUpdatedBoardMatch,
} from '../tournament/tournament-board-model.ts';
import { useTournamentBoard } from '../tournament/use-tournament-board.ts';

export type WeekBoard = ClientWeekTournamentBoardQuery['weekTournamentBoard'];

export interface UseWeekBoardInput {
  readonly board: TopPageSectionContext['board'];
  readonly clientViewer: ClientViewer | null;
  readonly autoRefresh: boolean;
  // 区画が描く行の状態から、定期の取り直しの間隔を決める
  readonly refetchIntervalOf: (
    input: TournamentBoardRefreshInput,
  ) => number | false;
  // 区画が描く行が変わり得る間だけ、画面へ戻った時に取り直す
  readonly canChange: (
    rounds: readonly WeekBoardRoundFieldsFragment[] | undefined,
  ) => boolean;
}

export interface WeekBoardSubscription {
  readonly weekBoard: WeekBoard;
  // ページを表示した時点と最後の境界の時刻のうち後の時点からの、取得の更新の回数
  readonly updatesSinceBaseline: number;
  // Upvote・取り消しの成功でサーバーが返したマッチを、取り直さずに盤面へ反映する
  readonly onUpdated: (match: MatchFragment) => void;
}

const WEEK_BOARD_ACCESS: TournamentBoardAccess<
  ClientWeekTournamentBoardQuery,
  WeekBoardRoundFieldsFragment
> = Object.freeze({
  roundsOf: (data: ClientWeekTournamentBoardQuery) =>
    data.weekTournamentBoard.rounds,
  withRounds: (
    data: ClientWeekTournamentBoardQuery,
    rounds: readonly WeekBoardRoundFieldsFragment[],
  ): ClientWeekTournamentBoardQuery => ({
    ...data,
    weekTournamentBoard: { ...data.weekTournamentBoard, rounds: [...rounds] },
  }),
});

const withUpdatedWeekBoardMatch = (
  data: ClientWeekTournamentBoardQuery | undefined,
  match: MatchFragment,
): ClientWeekTournamentBoardQuery | undefined =>
  withUpdatedBoardMatch(data, match, WEEK_BOARD_ACCESS);

// トップページのWeekトーナメントの区画(本文の行と決勝の注目)が共有する、当日の業務日付のWeekの盤面の購読
export function useWeekBoard({
  board,
  clientViewer,
  autoRefresh,
  refetchIntervalOf,
  canChange,
}: UseWeekBoardInput): WeekBoardSubscription {
  const queryOptions = useMemo(
    () => weekTournamentBoardQueryOptions(clientViewer, board.date),
    [clientViewer, board.date],
  );
  const { data, updatesSinceBaseline, onUpdated } = useTournamentBoard({
    clientViewer,
    autoRefresh,
    queryOptions,
    roundsOf: WEEK_BOARD_ACCESS.roundsOf,
    withUpdatedMatch: withUpdatedWeekBoardMatch,
    refetchIntervalOf,
    canChange,
  });
  return {
    weekBoard: data.weekTournamentBoard,
    updatesSinceBaseline,
    onUpdated,
  };
}
