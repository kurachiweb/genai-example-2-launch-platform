import type {
  YearTournamentRecord,
  YearTournamentStatus,
} from '../../../../../lib/core/year-tournament/ports.ts';
import type { BracketRoundView } from '../../../../application/tournament/bracket-view-builder.ts';
import type { YearBoardRound } from '../../../../application/year-tournament/year-board-reader.ts';
import type { YearBracketView } from '../../../../application/year-tournament/year-bracket-reader.ts';
import type { MatchProductSource } from '../match/mappers.ts';

export type YearTournamentStatusValue =
  'OPEN' | 'DRAWING' | 'IN_PROGRESS' | 'FINISHED';

const YEAR_TOURNAMENT_STATUS_VALUES = Object.freeze({
  open: 'OPEN',
  drawing: 'DRAWING',
  in_progress: 'IN_PROGRESS',
  finished: 'FINISHED',
} as const satisfies Record<YearTournamentStatus, YearTournamentStatusValue>);

export interface YearTournamentSummaryModel {
  readonly year: number;
  readonly label: string;
  readonly finalDate: string;
  readonly firstRoundDate: string | null;
  readonly status: YearTournamentStatusValue;
  readonly awarded: boolean | null;
}

// 対戦カードと不戦勝は項目のリゾルバがマッチの表示をまとめて引いて分けるため、マッチのIDだけを持つ
export interface YearTournamentRoundBoardModel {
  readonly tournament: YearTournamentSummaryModel;
  readonly round: number;
  readonly roundName: string;
  readonly final: boolean;
  readonly finalDate: string;
  // ブラケットの位置の順
  readonly matchIds: readonly string[];
  readonly bracketPath: string;
}

// ラウンドはtournament-weekのBracketRoundの型とリゾルバで解決するため、ブラケットの表示の組み立ての値をそのまま渡す
export interface YearBracketModel {
  readonly tournament: YearTournamentSummaryModel;
  readonly participantCount: number;
  readonly seedCount: number;
  readonly rounds: BracketRoundView[];
  readonly champion: MatchProductSource | null;
}

// 受賞したプロダクトが表示できなくなっても、受賞の結果は年の行の記録から返す
function awardedOf(tournament: YearTournamentRecord): boolean | null {
  return tournament.outcome === null ? null : tournament.outcome === 'awarded';
}

function toSummary(
  tournament: YearTournamentRecord,
): YearTournamentSummaryModel {
  return {
    year: tournament.year,
    label: `${String(tournament.year)}年`,
    finalDate: tournament.schedule.finalDate,
    firstRoundDate: tournament.firstRoundDate,
    status: YEAR_TOURNAMENT_STATUS_VALUES[tournament.status],
    awarded: awardedOf(tournament),
  };
}

export const toYearTournamentRoundBoard = (
  row: YearBoardRound,
): YearTournamentRoundBoardModel => ({
  tournament: toSummary(row.tournament),
  round: row.round,
  roundName: row.roundName,
  final: row.isFinal,
  finalDate: row.finalDate,
  matchIds: row.matchIds,
  bracketPath: row.bracketPath,
});

export const toYearBracket = (view: YearBracketView): YearBracketModel => ({
  tournament: toSummary(view.tournament),
  participantCount: view.rounds.participantCount,
  seedCount: view.rounds.seedCount,
  rounds: [...view.rounds.rounds],
  champion: view.champion,
});
