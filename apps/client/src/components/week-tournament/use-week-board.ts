import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type {
  ClientQualifierBoardQuery,
  MatchFragment,
} from '../../graphql/generated/graphql.ts';
import {
  qualifierBoardQueryOptions,
  toTopPageView,
} from '../../graphql/qualifier-board.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { weekTournamentBoardQueryOptions } from '../../graphql/week-tournament.ts';
import { updateCountOf } from '../match/follow-up-refetch.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import type { TopPageSectionContext } from '../top/top-page-section-types.ts';
import {
  type WeekBoard,
  type WeekBoardRefreshInput,
  withUpdatedWeekBoardMatch,
} from './week-board-model.ts';

export interface UseWeekBoardInput {
  readonly board: TopPageSectionContext['board'];
  readonly clientViewer: ClientViewer | null;
  readonly autoRefresh: boolean;
  // 区画が描く行の状態から、定期の取り直しの間隔を決める
  readonly refetchIntervalOf: (input: WeekBoardRefreshInput) => number | false;
  // 区画が描く行が変わり得る間だけ、画面へ戻った時に取り直す
  readonly canChange: (board: WeekBoard | undefined) => boolean;
}

export interface WeekBoardSubscription {
  readonly weekBoard: WeekBoard;
  // ページを表示した時点と最後の境界の時刻のうち後の時点からの、取得の更新の回数
  readonly updatesSinceBaseline: number;
  // Upvote・取り消しの成功でサーバーが返したマッチを、取り直さずに盤面へ反映する
  readonly onUpdated: (match: MatchFragment) => void;
}

const boundariesOf = (data: ClientQualifierBoardQuery) =>
  toTopPageView(data).boundaries;

// トップページのWeekトーナメントの区画(本文の行と決勝の注目)が共有する、当日の業務日付の盤面の購読。
// 定期の取り直しの判定は区画ごとに渡し、結果の反映や開始を待つ取り直しの回数の数えと境界の時刻の取り直しをここに集める
export function useWeekBoard({
  board,
  clientViewer,
  autoRefresh,
  refetchIntervalOf,
  canChange,
}: UseWeekBoardInput): WeekBoardSubscription {
  const queryClient = useQueryClient();
  const options = useMemo(
    () => weekTournamentBoardQueryOptions(clientViewer, board.date),
    [clientViewer, board.date],
  );
  const { queryKey } = options;
  const [baseline, setBaseline] = useState(() =>
    updateCountOf(queryClient.getQueryState(queryKey)),
  );
  const { data } = useSuspenseQuery({
    ...options,
    ...LIVE_REFRESH_QUERY_OPTIONS,
    refetchInterval: (query) =>
      refetchIntervalOf({
        board: query.state.data?.weekTournamentBoard,
        autoRefresh,
        updatesSinceBaseline: updateCountOf(query.state) - baseline,
      }),
    refetchOnWindowFocus: (query) =>
      canChange(query.state.data?.weekTournamentBoard),
    // 値が変わらない取り直しや失敗も回数に数えて上限の案内を出すため、更新の日時と失敗の回数の変化でも描き直す
    notifyOnChangeProps: ['data', 'dataUpdatedAt', 'errorUpdateCount'],
  });

  // 業務時刻の境界(当日の終了と翌日の開始)は経路のloaderが取得した予選の盤面から読み、取り直しは経路と予選の区画に任せる
  const { data: boundaries } = useSuspenseQuery({
    ...qualifierBoardQueryOptions(clientViewer),
    refetchOnMount: false,
    select: boundariesOf,
  });
  // 経路は予選だけを取り直すため、この盤面は区画が自分で取り直す。数えの基準を取り直しの前の回数に置き直し、境界の取り直しを上限の1回目に数える。
  // 同じ盤面を購読する他の区画も同じ境界で取り直すため、取得中なら新しく要求せずその取得の結果を待つ
  const refreshAtBoundary = useCallback(() => {
    setBaseline(updateCountOf(queryClient.getQueryState(queryKey)));
    void queryClient.invalidateQueries(
      { queryKey, exact: true },
      { cancelRefetch: false },
    );
  }, [queryClient, queryKey]);
  useBoundaryRefresh(boundaries, refreshAtBoundary);

  const onUpdated = useCallback(
    (match: MatchFragment) => {
      queryClient.setQueryData(queryKey, (current) =>
        withUpdatedWeekBoardMatch(current, match),
      );
    },
    [queryClient, queryKey],
  );

  return {
    weekBoard: data.weekTournamentBoard,
    updatesSinceBaseline:
      updateCountOf(queryClient.getQueryState(queryKey)) - baseline,
    onUpdated,
  };
}
