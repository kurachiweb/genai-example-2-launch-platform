import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type { ClientProductLiveMatchQuery } from '../../graphql/generated/graphql.ts';
import type { ProductPageView } from '../../graphql/product-page.ts';
import { FOLLOW_UP_REFETCH_LIMIT } from '../match/follow-up-refetch.ts';

type ProductLiveMatch = ClientProductLiveMatchQuery['productLiveMatch'];

type HeldLiveMatch = NonNullable<NonNullable<ProductLiveMatch>['match']>;

type BoundaryLaunch = Pick<
  ProductPageView['launches'][number],
  'kickoffAt' | 'kickedOff' | 'status'
>;

export interface LiveMatchRefreshInput {
  // 取得前はundefined、表示できないプロダクトはnull
  readonly liveMatch: ProductLiveMatch | undefined;
  readonly autoRefresh: boolean;
  // ページを表示した時点と最後の境界の取り直しのうち後の時点からの、取得の更新の回数
  readonly updatesSinceBaseline: number;
}

// 結果が確定したマッチは開催中の区画に置かず、マッチ履歴に任せる
export const heldLiveMatchOf = (
  liveMatch: ProductLiveMatch | undefined,
): HeldLiveMatch | null => {
  const match = liveMatch?.match ?? null;
  return match === null || match.phase === 'FINISHED' ? null : match;
};

// 集計中のマッチの確定や、キックオフの後の予選マッチの作成・開始を、日次のジョブの完了で待っている
const isAwaitingChange = (liveMatch: ProductLiveMatch | undefined): boolean =>
  liveMatch?.awaitingChange === true;

const isLive = (liveMatch: ProductLiveMatch | undefined): boolean =>
  heldLiveMatchOf(liveMatch)?.phase === 'LIVE';

export const canLiveMatchChange = (
  liveMatch: ProductLiveMatch | undefined,
): boolean => isLive(liveMatch) || isAwaitingChange(liveMatch);

// 定期の取り直し・残り時間・対戦カードの演出のいずれかを持つ
export const hasLiveMatchAutoUpdates = (
  liveMatch: ProductLiveMatch | undefined,
): boolean =>
  heldLiveMatchOf(liveMatch) !== null || isAwaitingChange(liveMatch);

export const liveMatchRefetchIntervalOf = ({
  liveMatch,
  autoRefresh,
  updatesSinceBaseline,
}: LiveMatchRefreshInput): number | false => {
  const awaiting = isAwaitingChange(liveMatch);
  if (autoRefresh && (awaiting || isLive(liveMatch))) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  if (awaiting && updatesSinceBaseline < FOLLOW_UP_REFETCH_LIMIT) {
    return LIVE_REFRESH_QUERY_OPTIONS.refetchInterval;
  }
  return false;
};

// 自動更新がオンの間は定期の取り直しが変化を待ち続けるため、案内はオフの時だけ出す
export const isLiveMatchFollowUpExhausted = ({
  liveMatch,
  autoRefresh,
  updatesSinceBaseline,
}: LiveMatchRefreshInput): boolean =>
  !autoRefresh &&
  isAwaitingChange(liveMatch) &&
  updatesSinceBaseline >= FOLLOW_UP_REFETCH_LIMIT;

// 開催中のマッチの終了と、予約済みのローンチのキックオフ(予選マッチの開始)で、開催中のマッチの答えが変わる
export const liveMatchBoundariesOf = (
  liveMatch: ProductLiveMatch | undefined,
  launches: readonly BoundaryLaunch[],
): string[] => {
  const endsAt = heldLiveMatchOf(liveMatch)?.endsAt;
  return [
    ...(endsAt === undefined ? [] : [endsAt]),
    ...launches
      .filter(({ kickedOff, status }) => !kickedOff && status !== 'CANCELED')
      .map(({ kickoffAt }) => kickoffAt),
  ];
};
