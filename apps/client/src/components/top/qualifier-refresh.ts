import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type {
  ClientQualifierBoardQuery,
  MatchFragment,
} from '../../graphql/generated/graphql.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';

type QualifierBoard = ClientQualifierBoardQuery['qualifierBoard'];

export interface QualifierRefreshInput {
  readonly board: QualifierBoard | undefined;
  readonly autoRefresh: boolean;
  // ページを表示した時点と最後の境界の取り直しのうち後の時点からの、取得の更新の回数
  readonly updatesSinceBaseline: number;
}

const hasLiveMatch = (board: QualifierBoard): boolean =>
  board.matches.some(({ phase }) => phase === 'LIVE');

// 日次のジョブの完了で、集計中のマッチの結果が確定するか、当日のマッチが始まるのを待っている
const isAwaitingChange = (board: QualifierBoard): boolean =>
  board.awaitingKickoff ||
  board.matches.some(({ phase }) => phase === 'TALLYING');

export const canQualifierBoardChange = (
  board: QualifierBoard | undefined,
): boolean =>
  board !== undefined && (hasLiveMatch(board) || isAwaitingChange(board));

export const qualifierRefetchIntervalOf = ({
  board,
  autoRefresh,
  updatesSinceBaseline,
}: QualifierRefreshInput): number | false => {
  if (board === undefined) {
    return false;
  }
  const awaiting = isAwaitingChange(board);
  if (autoRefresh && (awaiting || hasLiveMatch(board))) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  if (awaiting && updatesSinceBaseline < FOLLOW_UP_REFETCH_LIMIT) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  return false;
};

export const isFollowUpExhausted = ({
  board,
  autoRefresh,
  updatesSinceBaseline,
}: QualifierRefreshInput): boolean =>
  !autoRefresh &&
  board !== undefined &&
  isAwaitingChange(board) &&
  updatesSinceBaseline >= FOLLOW_UP_REFETCH_LIMIT;

// 並び替えはページを表示した時だけ行うため、取り直したマッチを最初に表示した順に並べ、その順に無いマッチは取得した順で末尾に加える
export const orderMatchesBy = (
  order: readonly string[],
  matches: readonly MatchFragment[],
): MatchFragment[] => {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const known = new Set(order);
  return [
    ...order.flatMap((id) => {
      const match = byId.get(id);
      return match === undefined ? [] : [match];
    }),
    ...matches.filter(({ id }) => !known.has(id)),
  ];
};
