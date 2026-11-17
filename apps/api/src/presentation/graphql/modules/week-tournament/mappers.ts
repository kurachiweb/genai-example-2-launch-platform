import {
  formatWeekPeriodLabel,
  isoWeekKey,
} from '../../../../../common-lib/tournament/week-period.ts';
import type {
  WeekTournamentRecord,
  WeekTournamentStatus,
} from '../../../../../lib/core/week-tournament/ports.ts';
import type {
  BracketNodeView,
  BracketRoundView,
  BracketSlotView,
} from '../../../../application/tournament/bracket-view-builder.ts';
import type {
  TrophyKind,
  TrophyRecord,
} from '../../../../application/tournament/trophy-source.ts';
import type { WeekBoardRound } from '../../../../application/week-tournament/week-board-reader.ts';
import type { WeekBracketView } from '../../../../application/week-tournament/week-bracket-reader.ts';
import type { MatchProductSource } from '../match/mappers.ts';

// WeekとYearのどちらの照会も、ブラケットの表示の組み立ての値をそのまま親の値にする
export type BracketRoundSource = BracketRoundView;

export type BracketNodeSource = BracketNodeView;

export type BracketSlotSource = BracketSlotView;

export type WeekTournamentStatusValue =
  'OPEN' | 'DRAWING' | 'IN_PROGRESS' | 'FINISHED';

export type TrophyKindValue = 'WEEK' | 'YEAR';

const WEEK_TOURNAMENT_STATUS_VALUES = Object.freeze({
  open: 'OPEN',
  drawing: 'DRAWING',
  in_progress: 'IN_PROGRESS',
  finished: 'FINISHED',
} as const satisfies Record<WeekTournamentStatus, WeekTournamentStatusValue>);

const TROPHY_KIND_VALUES = Object.freeze({
  week: 'WEEK',
  year: 'YEAR',
} as const satisfies Record<TrophyKind, TrophyKindValue>);

export interface WeekTournamentSummaryModel {
  readonly week: string;
  readonly label: string;
  readonly firstRoundDate: string | null;
  readonly finalDate: string | null;
  readonly status: WeekTournamentStatusValue;
  readonly awarded: boolean | null;
}

// 対戦カードと不戦勝は項目のリゾルバがマッチの表示をまとめて引いて分けるため、マッチのIDだけを持つ
export interface WeekTournamentRoundBoardModel {
  readonly tournament: WeekTournamentSummaryModel;
  readonly round: number;
  readonly roundName: string;
  readonly final: boolean;
  // ブラケットの位置の順
  readonly matchIds: readonly string[];
  readonly bracketPath: string;
}

export interface WeekBracketModel {
  readonly tournament: WeekTournamentSummaryModel;
  readonly participantCount: number;
  readonly seedCount: number;
  readonly rounds: BracketRoundSource[];
  readonly champion: MatchProductSource | null;
}

export interface TrophyModel {
  readonly kind: TrophyKindValue;
  readonly period: string;
  readonly periodLabel: string;
  readonly awardedAt: Date;
  readonly bracketPath: string | null;
}

function awardedOf(tournament: WeekTournamentRecord): boolean | null {
  return tournament.outcome === null ? null : tournament.outcome === 'awarded';
}

function toSummary(
  tournament: WeekTournamentRecord,
  dates: {
    readonly firstRoundDate: string | null;
    readonly finalDate: string | null;
  },
): WeekTournamentSummaryModel {
  const { weekStart } = tournament.window;
  return {
    week: isoWeekKey(weekStart),
    label: formatWeekPeriodLabel(weekStart),
    ...dates,
    status: WEEK_TOURNAMENT_STATUS_VALUES[tournament.status],
    awarded: awardedOf(tournament),
  };
}

export const toWeekTournamentRoundBoard = (
  row: WeekBoardRound,
): WeekTournamentRoundBoardModel => ({
  tournament: toSummary(row.tournament, {
    firstRoundDate: row.firstRoundDate,
    finalDate: row.finalDate,
  }),
  round: row.round,
  roundName: row.roundName,
  final: row.isFinal,
  matchIds: row.matchIds,
  bracketPath: row.bracketPath,
});

// 1回戦の日と決勝の日はブラケットの表示のラウンドの実施日から求める。参加0・1はラウンドが無いためnull
export function toWeekBracket(view: WeekBracketView): WeekBracketModel {
  const { rounds } = view.rounds;
  return {
    tournament: toSummary(view.tournament, {
      firstRoundDate: rounds[0]?.date ?? null,
      finalDate: rounds.at(-1)?.date ?? null,
    }),
    participantCount: view.rounds.participantCount,
    seedCount: view.rounds.seedCount,
    rounds: [...rounds],
    champion: view.champion,
  };
}

export const toTrophy = (trophy: TrophyRecord): TrophyModel => ({
  kind: TROPHY_KIND_VALUES[trophy.kind],
  period: trophy.period,
  periodLabel: trophy.periodLabel,
  awardedAt: trophy.awardedAt,
  bracketPath: trophy.bracketPath,
});
