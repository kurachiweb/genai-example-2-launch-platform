import { useEffect } from 'react';

import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { FOLLOW_UP_EXHAUSTED_MESSAGE } from '../match/follow-up-refetch-messages.ts';
import type { TopPageSectionContext } from '../top/top-page-section-types.ts';
import {
  canFinalChange,
  finalOutcomeOf,
  finalRefetchIntervalOf,
  finalRoundsOf,
  isFinalFollowUpExhausted,
  isFinalRoundAwaitingChange,
} from '../tournament/tournament-final-model.ts';
import { TournamentFinalRound } from '../tournament/tournament-final-round.tsx';
import { useYearBoard } from './use-year-board.ts';
import { YEAR_FINAL_COPY } from './year-tournament-messages.ts';

interface YearFinalBoardProps extends TopPageSectionContext {
  readonly clientViewer: ClientViewer | null;
}

// 本文のYearトーナメントの区画と同じ盤面を購読し、決勝の行だけを描く。定期の取り直しは決勝の行の状態で判定する
function YearFinalBoard({
  board,
  clientViewer,
  autoRefresh,
  reportAutoUpdating,
}: YearFinalBoardProps) {
  const { yearBoard, updatesSinceBaseline, onUpdated } = useYearBoard({
    board,
    clientViewer,
    autoRefresh,
    refetchIntervalOf: finalRefetchIntervalOf,
    canChange: canFinalChange,
  });

  const rows = finalRoundsOf(yearBoard.rounds);
  // 区画は照明の演出を常に持つ
  const autoUpdating = rows.length > 0;
  useEffect(() => {
    reportAutoUpdating(autoUpdating);
  }, [autoUpdating, reportAutoUpdating]);

  if (rows.length === 0) {
    return null;
  }
  const exhausted = isFinalFollowUpExhausted({
    rounds: yearBoard.rounds,
    autoRefresh,
    updatesSinceBaseline,
  });
  return (
    <div className="flex flex-col">
      {rows.map(({ round, ...row }) => (
        <TournamentFinalRound
          key={round.tournament.year}
          row={row}
          periodLabel={round.tournament.label}
          bracketPath={round.bracketPath}
          copy={YEAR_FINAL_COPY}
          outcome={finalOutcomeOf(row)}
          statusMessage={
            exhausted && isFinalRoundAwaitingChange(row)
              ? FOLLOW_UP_EXHAUSTED_MESSAGE
              : null
          }
          onUpdated={onUpdated}
        />
      ))}
    </div>
  );
}

// トップページの全幅の注目のYearトーナメントの決勝の区画。当日の業務日付の決勝を全幅で描き、確定の後は受賞か受賞なしを状態の文で示す。
// その日に決勝が無ければ何も描かない。取得の失敗はページの区画のエラーの境界がこの区画の位置に留める。
// 業務日付が変わると数えの基準ごと作り直し、翌日の盤面の更新の回数から数える
export function YearFinalShowcase(context: TopPageSectionContext) {
  const clientViewer = useViewer();
  return (
    <YearFinalBoard
      key={context.board.date}
      {...context}
      clientViewer={clientViewer}
    />
  );
}
