import { useEffect } from 'react';

import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { FOLLOW_UP_EXHAUSTED_MESSAGE } from '../match/follow-up-refetch-messages.ts';
import type { TopPageSectionContext } from '../top/top-page-section-types.ts';
import { useWeekBoard } from './use-week-board.ts';
import {
  canWeekBoardChange,
  isWeekFollowUpExhausted,
  weekBoardRefetchIntervalOf,
  weekSectionRoundsOf,
} from './week-board-model.ts';
import { WeekBoardRound } from './week-board-round.tsx';

interface WeekTournamentBoardProps extends TopPageSectionContext {
  readonly clientViewer: ClientViewer | null;
}

// 当日の業務日付の盤面のうち、決勝以外の行を描く。定期の取り直しは決勝以外の行の状態で判定する
function WeekTournamentBoard({
  board,
  clientViewer,
  autoRefresh,
  reportAutoUpdating,
}: WeekTournamentBoardProps) {
  const { weekBoard, updatesSinceBaseline, onUpdated } = useWeekBoard({
    board,
    clientViewer,
    autoRefresh,
    refetchIntervalOf: weekBoardRefetchIntervalOf,
    canChange: canWeekBoardChange,
  });

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
    updatesSinceBaseline,
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
