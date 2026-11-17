import {
  formatWeekPeriodLabel,
  isoWeekKey,
} from '../../../../../common-lib/tournament/week-period.ts';
import type {
  WeekTournamentRecord,
  WeekTournamentStatus,
} from '../../../../../lib/core/week-tournament/ports.ts';
import type {
  WeekEntryCloseReason,
  WeekEntryStatus,
} from '../../../../../lib/core/week-tournament/week-entry-rules.ts';
import type { CheckoutMoney } from '../../../../application/payments/checkout-view.ts';
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
import { weekBracketPathOf } from '../../../../application/week-tournament/week-bracket-path.ts';
import type { WeekEntryPanel } from '../../../../application/week-tournament/week-entry-panel-reader.ts';
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

export type WeekEntryStatusValue =
  | 'AWAITING_PAYMENT'
  | 'ENTITLED'
  | 'DRAWN'
  | 'EXPIRED'
  | 'FORFEITED'
  | 'EXCLUDED';

export type WeekEntryCloseReasonValue =
  'DEADLINE' | 'DELETED' | 'WITHDRAWN' | 'HIDDEN_OR_SUSPENDED' | 'LATE_ENTRY';

const WEEK_ENTRY_STATUS_VALUES = Object.freeze({
  awaiting_payment: 'AWAITING_PAYMENT',
  entitled: 'ENTITLED',
  drawn: 'DRAWN',
  expired: 'EXPIRED',
  forfeited: 'FORFEITED',
  excluded: 'EXCLUDED',
} as const satisfies Record<WeekEntryStatus, WeekEntryStatusValue>);

const WEEK_ENTRY_CLOSE_REASON_VALUES = Object.freeze({
  deadline: 'DEADLINE',
  deleted: 'DELETED',
  withdrawn: 'WITHDRAWN',
  hidden_or_suspended: 'HIDDEN_OR_SUSPENDED',
  late_entry: 'LATE_ENTRY',
} as const satisfies Record<WeekEntryCloseReason, WeekEntryCloseReasonValue>);

export interface WeekEntryProgressModel {
  readonly alive: boolean;
  readonly eliminatedRoundName: string | null;
  readonly champion: boolean;
}

export interface WeekEntryPanelModel {
  readonly launchId: string;
  readonly week: string;
  readonly weekLabel: string;
  readonly status: WeekEntryStatusValue;
  readonly closeReason: WeekEntryCloseReasonValue | null;
  readonly exempt: boolean;
  readonly acceptUntil: Date;
  readonly deadlineAt: Date;
  readonly fee: CheckoutMoney | null;
  readonly ultrasGuide: boolean;
  readonly serverTime: Date;
  readonly progress: WeekEntryProgressModel | null;
  readonly bracketPath: string | null;
}

// ブラケットのページは組み合わせを書き終えてブラケットを作った後だけ開ける
function entryBracketPathOf({
  entry,
  tournament,
}: WeekEntryPanel): string | null {
  return entry.status === 'drawn' && tournament.bracketId !== null
    ? weekBracketPathOf(tournament.window.weekStart)
    : null;
}

export function toWeekEntryPanel(
  panel: WeekEntryPanel,
  serverTime: Date,
): WeekEntryPanelModel {
  const { entry, tournament, progress } = panel;
  // 導線はローンチから枠を引くため、紐付けを解除した枠は返らない
  if (entry.launchId === null) {
    throw new Error(`参加の枠のローンチがありません: ${entry.entryId}`);
  }
  const { weekStart, acceptUntil, deadlineAt } = tournament.window;
  return {
    launchId: entry.launchId,
    week: isoWeekKey(weekStart),
    weekLabel: formatWeekPeriodLabel(weekStart),
    status: WEEK_ENTRY_STATUS_VALUES[entry.status],
    closeReason:
      entry.closeReason === null
        ? null
        : WEEK_ENTRY_CLOSE_REASON_VALUES[entry.closeReason],
    exempt: panel.exempt,
    acceptUntil,
    deadlineAt,
    fee: panel.fee,
    ultrasGuide: panel.ultrasGuide,
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
