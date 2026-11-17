import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { useViewer } from '../auth/use-viewer.ts';
import { FOLLOW_UP_EXHAUSTED_MESSAGE } from '../match/follow-up-refetch-messages.ts';
import { updateCountOf } from '../match/follow-up-refetch.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import type { TopPageSectionContext } from '../top/top-page-section-types.ts';
import {
  canWeekBoardChange,
  isWeekFollowUpExhausted,
  weekBoardRefetchIntervalOf,
  weekSectionRoundsOf,
  withUpdatedWeekBoardMatch,
} from './week-board-model.ts';
import { WeekBoardRound } from './week-board-round.tsx';

interface WeekTournamentBoardProps extends TopPageSectionContext {
  readonly clientViewer: ClientViewer | null;
}

const boundariesOf = (data: ClientQualifierBoardQuery) =>
  toTopPageView(data).boundaries;

// 当日の業務日付の盤面の購読を持つ。定期の取り直しの判定と、結果の反映や開始を待つ取り直しの回数の数えをここに集める。
// 回数は、ページを表示した時点と最後の境界の時刻のうち後の時点の取得の更新の回数を基準にして数える
function WeekTournamentBoard({
  board,
  clientViewer,
  autoRefresh,
  reportAutoUpdating,
}: WeekTournamentBoardProps) {
  const queryClient = useQueryClient();
  const options = useMemo(
    () => weekTournamentBoardQueryOptions(clientViewer, board.date),
    [clientViewer, board.date],
  );
  const { queryKey } = options;
  const updateCountNow = (): number =>
    updateCountOf(queryClient.getQueryState(queryKey));
  const [baseline, setBaseline] = useState(updateCountNow);
  const { data } = useSuspenseQuery({
    ...options,
    ...LIVE_REFRESH_QUERY_OPTIONS,
    refetchInterval: (query) =>
      weekBoardRefetchIntervalOf({
        board: query.state.data?.weekTournamentBoard,
        autoRefresh,
        updatesSinceBaseline: updateCountOf(query.state) - baseline,
      }),
    refetchOnWindowFocus: (query) =>
      canWeekBoardChange(query.state.data?.weekTournamentBoard),
    // 値が変わらない取り直しや失敗も回数に数えて上限の案内を出すため、更新の日時と失敗の回数の変化でも描き直す
    notifyOnChangeProps: ['data', 'dataUpdatedAt', 'errorUpdateCount'],
  });
  const weekBoard = data.weekTournamentBoard;

  // 業務時刻の境界(当日の終了と翌日の開始)は経路のloaderが取得した予選の盤面から読み、取り直しは経路と予選の区画に任せる
  const { data: boundaries } = useSuspenseQuery({
    ...qualifierBoardQueryOptions(clientViewer),
    refetchOnMount: false,
    select: boundariesOf,
  });
  // 経路は予選だけを取り直すため、この区画の盤面は自分で取り直す。数えの基準を取り直しの前の回数に置き直し、境界の取り直しを上限の1回目に数える
  const refreshAtBoundary = useCallback(() => {
    setBaseline(updateCountOf(queryClient.getQueryState(queryKey)));
    void queryClient.invalidateQueries({ queryKey, exact: true });
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

  const rows = weekSectionRoundsOf(weekBoard.rounds);
  // 対戦カードはピッチの演出を持つ
  const autoUpdating =
    rows.some(({ cards }) => cards.length > 0) || canWeekBoardChange(weekBoard);
  useEffect(() => {
    reportAutoUpdating(autoUpdating);
  }, [autoUpdating, reportAutoUpdating]);

  if (rows.length === 0) {
    return null;
  }
  const exhausted = isWeekFollowUpExhausted({
    board: weekBoard,
    autoRefresh,
    updatesSinceBaseline: updateCountNow() - baseline,
  });
  const statusMessage = exhausted ? FOLLOW_UP_EXHAUSTED_MESSAGE : null;
  return (
    <div className="flex flex-col gap-10">
      {rows.map((row, index) => (
        <WeekBoardRound
          key={`${row.round.tournament.week}:${String(row.round.round)}`}
          row={row}
          onUpdated={onUpdated}
          statusMessage={index === 0 ? statusMessage : undefined}
        />
      ))}
    </div>
  );
}

// トップページの本文のWeekトーナメントの区画。当日の業務日付のマッチをトーナメントとラウンドごとに描き、決勝の行は全幅の注目の区画に任せる。
// その日にマッチが無ければ何も描かない。取得の失敗はページの区画のエラーの境界がこの区画の位置に留める。
// 業務日付が変わると数えの基準ごと作り直し、翌日の盤面の更新の回数から数える
export function WeekTournamentSection(context: TopPageSectionContext) {
  const clientViewer = useViewer();
  return (
    <WeekTournamentBoard
      key={context.board.date}
      {...context}
      clientViewer={clientViewer}
    />
  );
}
