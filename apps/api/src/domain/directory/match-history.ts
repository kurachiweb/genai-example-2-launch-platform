import {
  type EntryResult,
  isWinningResult,
  type MatchDecision,
  type MatchKind,
  type MatchStage,
} from '../../../lib/core/match/match-model.ts';
import type {
  MatchEntryRecord,
  MatchRecord,
} from '../../../lib/core/match/ports.ts';
import type {
  LaunchRecord,
  ProductSummaryRecord,
} from '../../../lib/core/product/ports.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';

export type OpponentView =
  | { readonly kind: 'none' }
  | { readonly kind: 'private' }
  | { readonly kind: 'unlisted' | 'listed'; readonly productId: string };

export interface HistoryRow {
  readonly matchId: string;
  readonly entryId: string;
  readonly kind: MatchKind;
  readonly round: number | null;
  readonly stage: MatchStage | null;
  readonly matchDate: BusinessDate;
  readonly result: EntryResult;
  readonly decision: MatchDecision;
  readonly endedEarly: boolean;
  readonly ownUpvoteCount: number;
  // 不戦勝(開始時点の相手の該当を含む)・早期の不戦勝はnull
  readonly opponentUpvoteCount: number | null;
  readonly opponent: OpponentView;
}

export interface MatchRecordSummary {
  readonly firstLaunchDate: BusinessDate | null;
  readonly launchCount: number;
  readonly wins: number;
  readonly losses: number;
}

const NO_OPPONENT: OpponentView = Object.freeze({ kind: 'none' });
const PRIVATE_OPPONENT: OpponentView = Object.freeze({ kind: 'private' });

export function isKickedOff(launch: Pick<LaunchRecord, 'status'>): boolean {
  return launch.status === 'in_progress' || launch.status === 'finished';
}

function opponentViewOf(
  opponent: MatchEntryRecord,
  opponents: ReadonlyMap<string, ProductSummaryRecord>,
): OpponentView {
  const product =
    opponent.productId === null ? undefined : opponents.get(opponent.productId);
  if (product === undefined || !product.visible) {
    return PRIVATE_OPPONENT;
  }
  return {
    kind: product.listed ? 'listed' : 'unlisted',
    productId: product.productId,
  };
}

// 不戦勝は相手と戦っていないため、相手が開始時点やマッチ中に該当していれば理由を推測させないよう相手を出さない
function toHistoryRow(
  match: MatchRecord,
  own: MatchEntryRecord,
  opponents: ReadonlyMap<string, ProductSummaryRecord>,
): HistoryRow {
  const { result } = own;
  if (result === null || match.decision === null) {
    throw new RangeError(
      `確定したマッチの結果がありません: ${match.matchId} ${own.entryId}`,
    );
  }
  const opponent = match.entries.find((entry) => entry.entryId !== own.entryId);
  const isWalkoverWin = result === 'bye' || result === 'walkover';
  const opponentView =
    opponent === undefined
      ? NO_OPPONENT
      : isWalkoverWin
        ? PRIVATE_OPPONENT
        : opponentViewOf(opponent, opponents);
  return {
    matchId: match.matchId,
    entryId: own.entryId,
    kind: match.kind,
    round: match.round,
    stage: match.stage,
    matchDate: match.matchDate,
    result,
    decision: match.decision,
    endedEarly: match.endedEarly,
    ownUpvoteCount: own.upvoteCount,
    opponentUpvoteCount:
      isWalkoverWin || opponent === undefined ? null : opponent.upvoteCount,
    opponent: opponentView,
  };
}

// 業務日付はYYYY-MM-DDの固定長のため、文字列の比較が日付の前後と一致する
function compareNewestFirst(first: MatchRecord, second: MatchRecord): number {
  if (first.matchDate !== second.matchDate) {
    return first.matchDate < second.matchDate ? 1 : -1;
  }
  return (second.decidedAt?.getTime() ?? 0) - (first.decidedAt?.getTime() ?? 0);
}

// 自分の側が無いマッチは照会の間の物理削除による紐付けの解除だけで起きるため、行にせず読み飛ばす
export function toHistoryRows(input: {
  readonly productId: string;
  readonly matches: readonly MatchRecord[];
  readonly opponents: ReadonlyMap<string, ProductSummaryRecord>;
}): readonly HistoryRow[] {
  const { productId, matches, opponents } = input;
  return matches
    .filter((match) => match.phase === 'finished')
    .toSorted(compareNewestFirst)
    .flatMap((match) => {
      const own = match.entries.find((entry) => entry.productId === productId);
      return own === undefined ? [] : [toHistoryRow(match, own, opponents)];
    });
}

export function summarizeRecord(input: {
  readonly rows: readonly HistoryRow[];
  readonly launches: readonly LaunchRecord[];
}): MatchRecordSummary {
  const kickedOff = input.launches.filter(isKickedOff);
  const firstLaunchDate = kickedOff.reduce<BusinessDate | null>(
    (earliest, launch) =>
      earliest === null || launch.launchDate < earliest
        ? launch.launchDate
        : earliest,
    null,
  );
  const wins = input.rows.filter((row) => isWinningResult(row.result)).length;
  return {
    firstLaunchDate,
    launchCount: kickedOff.length,
    wins,
    losses: input.rows.length - wins,
  };
}
