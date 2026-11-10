import type {
  EntryResult,
  MatchDecision,
  MatchKind,
  MatchPhase,
  MatchStage,
} from '../../../../../lib/core/match/match-model.ts';
import type {
  MatchEntryView,
  MatchProductView,
  MatchView,
} from '../../../../application/match/match-view-reader.ts';
import type {
  QualifierBoard,
  QualifierBoardBye,
} from '../../../../application/match/qualifier-board-reader.ts';
import type {
  UpvoteHistoryEntry,
  UpvoteHistoryPage,
} from '../../../../application/match/upvote-history-reader.ts';
import type { ByeReason } from '../../../../domain/match/board-order.ts';
import type { UpvoteRestriction } from '../../../../domain/match/upvote-plan.ts';

// 項目のリゾルバが値の一覧の写し・画像・カテゴリを解決するため、ユースケースの表示をそのまま親の値にする
export type MatchSource = MatchView;

export type MatchEntrySource = MatchEntryView;

export type MatchProductSource = MatchProductView;

export type MatchKindValue = 'QUALIFIER' | 'WEEK' | 'YEAR';

export type MatchStageValue = 'QUARTERFINAL' | 'SEMIFINAL' | 'FINAL';

export type MatchPhaseValue = 'SCHEDULED' | 'LIVE' | 'TALLYING' | 'FINISHED';

export type MatchEntryResultValue = 'WON' | 'LOST' | 'BYE' | 'WALKOVER';

export type MatchDecisionValue =
  'VOTES' | 'LAST_UPVOTE' | 'NO_VOTES' | 'BYE' | 'WALKOVER' | 'BOTH_FORFEITED';

export type UpvoteRestrictionValue =
  | 'GUEST'
  | 'EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_UNAVAILABLE'
  | 'OWN_MATCH'
  | 'NOT_ACCEPTING';

export type ByeReasonValue = 'ABSENT' | 'FORFEIT' | 'EARLY';

export type QualifierBoardPhaseValue = 'LIVE' | 'RESULT';

export const MATCH_KIND_VALUES = Object.freeze({
  qualifier: 'QUALIFIER',
  week: 'WEEK',
  year: 'YEAR',
} as const satisfies Record<MatchKind, MatchKindValue>);

export const MATCH_STAGE_VALUES = Object.freeze({
  quarterfinal: 'QUARTERFINAL',
  semifinal: 'SEMIFINAL',
  final: 'FINAL',
} as const satisfies Record<MatchStage, MatchStageValue>);

export const MATCH_PHASE_VALUES = Object.freeze({
  scheduled: 'SCHEDULED',
  live: 'LIVE',
  tallying: 'TALLYING',
  finished: 'FINISHED',
} as const satisfies Record<MatchPhase, MatchPhaseValue>);

export const MATCH_ENTRY_RESULT_VALUES = Object.freeze({
  won: 'WON',
  lost: 'LOST',
  bye: 'BYE',
  walkover: 'WALKOVER',
} as const satisfies Record<EntryResult, MatchEntryResultValue>);

export const MATCH_DECISION_VALUES = Object.freeze({
  votes: 'VOTES',
  last_upvote: 'LAST_UPVOTE',
  no_votes: 'NO_VOTES',
  bye: 'BYE',
  walkover: 'WALKOVER',
  both_forfeited: 'BOTH_FORFEITED',
} as const satisfies Record<MatchDecision, MatchDecisionValue>);

export const UPVOTE_RESTRICTION_VALUES = Object.freeze({
  guest: 'GUEST',
  email_not_verified: 'EMAIL_NOT_VERIFIED',
  account_unavailable: 'ACCOUNT_UNAVAILABLE',
  own_match: 'OWN_MATCH',
  not_accepting: 'NOT_ACCEPTING',
} as const satisfies Record<UpvoteRestriction, UpvoteRestrictionValue>);

const BYE_REASON_VALUES = Object.freeze({
  absent: 'ABSENT',
  forfeit: 'FORFEIT',
  early: 'EARLY',
} as const satisfies Record<ByeReason, ByeReasonValue>);

const BOARD_PHASE_VALUES = Object.freeze({
  live: 'LIVE',
  result: 'RESULT',
} as const satisfies Record<QualifierBoard['phase'], QualifierBoardPhaseValue>);

export interface MatchByeModel {
  readonly match: MatchSource;
  readonly entry: MatchEntrySource;
  readonly reason: ByeReasonValue;
}

export interface QualifierBoardModel {
  readonly date: string;
  readonly serverTime: Date;
  readonly phase: QualifierBoardPhaseValue;
  readonly fullTimeAt: Date;
  readonly nextKickoffAt: Date;
  readonly awaitingKickoff: boolean;
  readonly heldCount: number;
  readonly matches: MatchSource[];
  readonly byes: MatchByeModel[];
}

// 不戦勝の側はリーダーがマッチの側から選ぶため、見つからないのはデータの不整合である
function toMatchBye(bye: QualifierBoardBye): MatchByeModel {
  const entry = bye.view.entries.find(
    (candidate) => candidate.entryId === bye.entryId,
  );
  if (entry === undefined) {
    throw new Error(
      `マッチ${bye.view.record.matchId}に不戦勝の側${bye.entryId}がありません`,
    );
  }
  return { match: bye.view, entry, reason: BYE_REASON_VALUES[bye.reason] };
}

export const toQualifierBoard = (
  board: QualifierBoard,
): QualifierBoardModel => ({
  date: board.date,
  serverTime: board.serverTime,
  phase: BOARD_PHASE_VALUES[board.phase],
  fullTimeAt: board.fullTimeAt,
  nextKickoffAt: board.nextKickoffAt,
  awaitingKickoff: board.awaitingKickoff,
  heldCount: board.heldCount,
  matches: [...board.cards],
  byes: board.byes.map(toMatchBye),
});

// 投稿者は項目のリゾルバが一括読み込みで引くため、IDだけを持つ。UpvoteのIDは時刻を含むため持たない
export interface UpvoteHistoryItemModel {
  readonly id: string;
  readonly matchId: string;
  readonly kind: MatchKindValue;
  readonly round: number | null;
  readonly stage: MatchStageValue | null;
  readonly date: string;
  readonly live: boolean;
  readonly product: MatchProductSource;
  readonly ownerUserId: string;
}

export interface UpvoteHistoryConnectionModel {
  readonly totalCount: number;
  readonly dateTotals: { readonly date: string; readonly count: number }[];
  readonly nodes: UpvoteHistoryItemModel[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

const toUpvoteHistoryItem = (
  entry: UpvoteHistoryEntry,
): UpvoteHistoryItemModel => ({
  id: entry.matchId,
  matchId: entry.matchId,
  kind: MATCH_KIND_VALUES[entry.kind],
  round: entry.round,
  stage: entry.stage === null ? null : MATCH_STAGE_VALUES[entry.stage],
  date: entry.matchDate,
  live: entry.live,
  product: entry.product,
  ownerUserId: entry.ownerUserId,
});

export const toUpvoteHistoryConnection = (
  page: UpvoteHistoryPage,
): UpvoteHistoryConnectionModel => ({
  totalCount: page.totalCount,
  dateTotals: page.dateTotals.map(({ date, count }) => ({ date, count })),
  nodes: page.entries.map(toUpvoteHistoryItem),
  pageInfo: { hasNextPage: page.hasNextPage, endCursor: page.endCursor },
});
