import {
  formatWeekPeriodLabel,
  parseIsoWeek,
} from '../../../../../common-lib/tournament/week-period.ts';
import type {
  YearTournamentRecord,
  YearTournamentStatus,
} from '../../../../../lib/core/year-tournament/ports.ts';
import type {
  YearEntryCloseReason,
  YearEntryStatus,
} from '../../../../../lib/core/year-tournament/year-entry-rules.ts';
import type { CheckoutMoney } from '../../../../application/payments/checkout-view.ts';
import type { BracketRoundView } from '../../../../application/tournament/bracket-view-builder.ts';
import type { YearBoardRound } from '../../../../application/year-tournament/year-board-reader.ts';
import { yearBracketPathOf } from '../../../../application/year-tournament/year-bracket-path.ts';
import type { YearBracketView } from '../../../../application/year-tournament/year-bracket-reader.ts';
import type { YearEntryPanel } from '../../../../application/year-tournament/year-entry-panel-reader.ts';
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

const yearLabelOf = (year: number): string => `${String(year)}年`;

// 受賞したプロダクトが表示できなくなっても、受賞の結果は年の行の記録から返す
function awardedOf(tournament: YearTournamentRecord): boolean | null {
  return tournament.outcome === null ? null : tournament.outcome === 'awarded';
}

function toSummary(
  tournament: YearTournamentRecord,
): YearTournamentSummaryModel {
  return {
    year: tournament.year,
    label: yearLabelOf(tournament.year),
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

export type YearEntryStatusValue =
  | 'AWAITING_PAYMENT'
  | 'ENTITLED'
  | 'DRAWN'
  | 'EXPIRED'
  | 'FORFEITED'
  | 'EXCLUDED';

export type YearEntryCloseReasonValue =
  | 'DEADLINE'
  | 'DELETED'
  | 'WITHDRAWN'
  | 'HIDDEN_OR_SUSPENDED'
  | 'OVER_CAPACITY'
  | 'LATE_ENTRY';

const YEAR_ENTRY_STATUS_VALUES = Object.freeze({
  awaiting_payment: 'AWAITING_PAYMENT',
  entitled: 'ENTITLED',
  drawn: 'DRAWN',
  expired: 'EXPIRED',
  forfeited: 'FORFEITED',
  excluded: 'EXCLUDED',
} as const satisfies Record<YearEntryStatus, YearEntryStatusValue>);

const YEAR_ENTRY_CLOSE_REASON_VALUES = Object.freeze({
  deadline: 'DEADLINE',
  deleted: 'DELETED',
  withdrawn: 'WITHDRAWN',
  hidden_or_suspended: 'HIDDEN_OR_SUSPENDED',
  over_capacity: 'OVER_CAPACITY',
  late_entry: 'LATE_ENTRY',
} as const satisfies Record<YearEntryCloseReason, YearEntryCloseReasonValue>);

export interface YearEntryProgressModel {
  readonly alive: boolean;
  readonly eliminatedRoundName: string | null;
  readonly champion: boolean;
}

export interface YearEntryPanelModel {
  readonly launchId: string;
  readonly year: number;
  readonly yearLabel: string;
  readonly weekLabel: string;
  readonly finalDate: string;
  readonly status: YearEntryStatusValue;
  readonly closeReason: YearEntryCloseReasonValue | null;
  readonly refundable: boolean;
  readonly exempt: boolean;
  readonly acceptUntil: Date;
  readonly deadlineAt: Date;
  readonly drawAt: Date;
  readonly fee: CheckoutMoney | null;
  readonly serverTime: Date;
  readonly progress: YearEntryProgressModel | null;
  readonly bracketPath: string | null;
}

function weekLabelOf({ entryId, weekPeriod }: YearEntryPanel['entry']): string {
  const week = parseIsoWeek(weekPeriod);
  if (week === undefined) {
    throw new Error(`参加の枠のWeek優勝の週が不正です: ${entryId}`);
  }
  return formatWeekPeriodLabel(week.weekStart);
}

// ブラケットのページは組み合わせを書き終えてブラケットを作った後だけ開ける
function entryBracketPathOf({ entry, year }: YearEntryPanel): string | null {
  return entry.status === 'drawn' && (year.record?.bracketId ?? null) !== null
    ? yearBracketPathOf(year.year)
    : null;
}

export function toYearEntryPanel(
  panel: YearEntryPanel,
  serverTime: Date,
): YearEntryPanelModel {
  const { entry, year, progress } = panel;
  const { finalDate, acceptUntil, deadlineAt, drawAt } = year.schedule;
  return {
    launchId: panel.launchId,
    year: year.year,
    yearLabel: yearLabelOf(year.year),
    weekLabel: weekLabelOf(entry),
    finalDate,
    status: YEAR_ENTRY_STATUS_VALUES[entry.status],
    closeReason:
      entry.closeReason === null
        ? null
        : YEAR_ENTRY_CLOSE_REASON_VALUES[entry.closeReason],
    refundable: panel.refundable,
    exempt: panel.exempt,
    acceptUntil,
    deadlineAt,
    drawAt,
    fee: panel.fee,
    serverTime,
    progress:
      progress === null
        ? null
        : {
            alive: progress.alive,
            eliminatedRoundName: progress.eliminatedRoundName,
            champion: progress.champion,
          },
    bracketPath: entryBracketPathOf(panel),
  };
}
