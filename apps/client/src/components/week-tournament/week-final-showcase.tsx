import { useEffect } from 'react';

import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { FOLLOW_UP_EXHAUSTED_MESSAGE } from '../match/follow-up-refetch-messages.ts';
import type { TopPageSectionContext } from '../top/top-page-section-types.ts';
import { useWeekBoard } from './use-week-board.ts';
import {
  canWeekFinalChange,
  isWeekFinalFollowUpExhausted,
  isWeekFinalRoundAwaitingChange,
  weekFinalOutcomeOf,
  weekFinalRefetchIntervalOf,
  weekFinalRoundsOf,
} from './week-final-model.ts';
import { WeekFinalRound } from './week-final-round.tsx';

interface WeekFinalBoardProps extends TopPageSectionContext {
  readonly clientViewer: ClientViewer | null;
}

// 本文のWeekトーナメントの区画と同じ盤面を購読し、決勝の行だけを描く。定期の取り直しは決勝の行の状態で判定する
function WeekFinalBoard({
  board,
  clientViewer,
  autoRefresh,
  reportAutoUpdating,
}: WeekFinalBoardProps) {
  const { weekBoard, updatesSinceBaseline, onUpdated } = useWeekBoard({
    board,
    clientViewer,
    autoRefresh,
    refetchIntervalOf: weekFinalRefetchIntervalOf,
    canChange: canWeekFinalChange,
  });

  const rows = weekFinalRoundsOf(weekBoard.rounds);
  // 区画は照明の演出を常に持つ
  const autoUpdating = rows.length > 0;
  useEffect(() => {
    reportAutoUpdating(autoUpdating);
  }, [autoUpdating, reportAutoUpdating]);

  if (rows.length === 0) {
    return null;
  }
  const exhausted = isWeekFinalFollowUpExhausted({
    board: weekBoard,
    autoRefresh,
    updatesSinceBaseline,
  });
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <WeekFinalRound
          key={row.round.tournament.week}
          row={row}
          outcome={weekFinalOutcomeOf(row)}
          statusMessage={
            exhausted && isWeekFinalRoundAwaitingChange(row)
              ? FOLLOW_UP_EXHAUSTED_MESSAGE
              : null
          }
          onUpdated={onUpdated}
        />
      ))}
    </div>
  );
}

// トップページの全幅の注目のWeekトーナメントの決勝の区画。当日の業務日付の決勝を全幅で描き、確定の後は受賞か受賞なしを状態の文で示す。
// その日に決勝が無ければ何も描かない。取得の失敗はページの区画のエラーの境界がこの区画の位置に留める。
// 業務日付が変わると数えの基準ごと作り直し、翌日の盤面の更新の回数から数える
export function WeekFinalShowcase(context: TopPageSectionContext) {
  const clientViewer = useViewer();
  return (
    <WeekFinalBoard
      key={context.board.date}
      {...context}
      clientViewer={clientViewer}
    />
  );
}
