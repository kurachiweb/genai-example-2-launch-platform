import { useEffect } from 'react';

import type { ClientViewer } from '../../graphql/viewer.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { FOLLOW_UP_EXHAUSTED_MESSAGE } from '../match/follow-up-refetch-messages.ts';
import type { TopPageSectionContext } from '../top/top-page-section-types.ts';
import {
  boardRefetchIntervalOf,
  canBoardChange,
  isBoardFollowUpExhausted,
  sectionRoundsOf,
} from '../tournament/tournament-board-model.ts';
import { TournamentBoardRound } from '../tournament/tournament-board-round.tsx';
import { TournamentSectionHeading } from '../tournament/tournament-section-heading.tsx';
import { useYearBoard } from './use-year-board.ts';
import { YEAR_BOARD_COPY } from './year-tournament-messages.ts';

interface YearTournamentBoardProps extends TopPageSectionContext {
  readonly clientViewer: ClientViewer | null;
}

// 当日の業務日付の盤面のうち、決勝以外の行を描く。定期の取り直しは決勝以外の行の状態で判定する
function YearTournamentBoard({
  board,
  clientViewer,
  autoRefresh,
  reportAutoUpdating,
}: YearTournamentBoardProps) {
  const { yearBoard, updatesSinceBaseline, onUpdated } = useYearBoard({
    board,
    clientViewer,
    autoRefresh,
    refetchIntervalOf: boardRefetchIntervalOf,
    canChange: canBoardChange,
  });

  const rows = sectionRoundsOf(yearBoard.rounds);
  // 対戦カードはピッチの演出を持つ
  const autoUpdating =
    rows.some(({ cards }) => cards.length > 0) ||
    canBoardChange(yearBoard.rounds);
  useEffect(() => {
    reportAutoUpdating(autoUpdating);
  }, [autoUpdating, reportAutoUpdating]);

  if (rows.length === 0) {
    return null;
  }
  const exhausted = isBoardFollowUpExhausted({
    rounds: yearBoard.rounds,
    autoRefresh,
    updatesSinceBaseline,
  });
  const statusMessage = exhausted ? FOLLOW_UP_EXHAUSTED_MESSAGE : null;
  return (
    <div className="flex flex-col gap-10">
      {rows.map(({ round, ...row }, index) => (
        <TournamentBoardRound
          key={`${String(round.tournament.year)}:${String(round.round)}`}
          row={row}
          onUpdated={onUpdated}
          statusMessage={index === 0 ? statusMessage : undefined}
        >
          {(headingId) => (
            <TournamentSectionHeading
              id={headingId}
              title={YEAR_BOARD_COPY.sectionTitle}
              roundName={round.roundName}
              periodLabel={round.tournament.label}
              finalDate={round.finalDate}
              bracketPath={round.bracketPath}
            />
          )}
        </TournamentBoardRound>
      ))}
    </div>
  );
}

// トップページの本文のYearトーナメントの区画。当日の業務日付のマッチをラウンドごとに描き、決勝の行は全幅の注目の区画に任せる。
// 見出しの決勝日は、ラウンドの遅れの後に遅らせた後の日を示す行の決勝日を使う。
// その日にマッチが無ければ何も描かない。取得の失敗はページの区画のエラーの境界がこの区画の位置に留める。
// 業務日付が変わると数えの基準ごと作り直し、翌日の盤面の更新の回数から数える
export function YearTournamentSection(context: TopPageSectionContext) {
  const clientViewer = useViewer();
  return (
    <YearTournamentBoard
      key={context.board.date}
      {...context}
      clientViewer={clientViewer}
    />
  );
}
