import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import type { MatchFragment } from '../../graphql/generated/graphql.ts';
import {
  PRODUCT_PAGE_QUERY_PREFIX,
  productLiveMatchQueryOptions,
  withUpdatedLiveMatch,
} from '../../graphql/product-page.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { SectionHeading } from '../layout/section-heading.tsx';
import { FOLLOW_UP_EXHAUSTED_MESSAGE } from '../match/follow-up-refetch-messages.ts';
import { updateCountOf } from '../match/follow-up-refetch.ts';
import { FullTimeCountdown } from '../match/full-time-countdown.tsx';
import { MatchCard } from '../match/match-card.tsx';
import { matchStageLabel } from '../match/match-labels.ts';
import { useUpvote } from '../match/use-upvote.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import {
  canLiveMatchChange,
  hasLiveMatchAutoUpdates,
  heldLiveMatchOf,
  isLiveMatchFollowUpExhausted,
  liveMatchBoundariesOf,
  liveMatchRefetchIntervalOf,
} from './live-match-refresh.ts';
import {
  LIVE_MATCH_BADGE,
  LIVE_MATCH_OWNER_DESCRIPTION,
  LIVE_MATCH_VIEWER_DESCRIPTION,
  liveMatchTitle,
} from './live-match-messages.ts';
import { LIVE_MATCH_HEADING_ID } from './match-history-messages.ts';
import type { ProductPageContext } from './product-page-section-types.ts';

type HeldLiveMatch = NonNullable<ReturnType<typeof heldLiveMatchOf>>;

interface LiveMatchCardProps {
  readonly match: HeldLiveMatch;
  readonly onUpdated: (match: MatchFragment) => void;
}

// useUpvoteは開催中のマッチがある間だけ呼ぶため、対戦カードを別の部品にする
function LiveMatchCard({ match, onUpdated }: LiveMatchCardProps) {
  const { pendingEntryId, toggle, loginDialog } = useUpvote({
    match,
    onUpdated,
  });
  return (
    <>
      <MatchCard
        match={match}
        pendingEntryId={pendingEntryId}
        onToggleUpvote={toggle}
      />
      {loginDialog}
    </>
  );
}

const descriptionFor = (isOwner: boolean): string =>
  isOwner ? LIVE_MATCH_OWNER_DESCRIPTION : LIVE_MATCH_VIEWER_DESCRIPTION;

function LiveBadge() {
  return (
    <span
      translate="no"
      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold tracking-widest text-primary-foreground"
    >
      <span
        className="size-2 rounded-full bg-primary-foreground"
        aria-hidden="true"
      />
      {LIVE_MATCH_BADGE}
    </span>
  );
}

// 開催中のマッチの取得の購読を持つ区画。定期の取り直しの判定と、結果の反映を待つ取り直しの回数の数え、確定の後の詳細ページの取り直しをここに集める。
// 境界の時刻の取り直しそのものは、区画の失敗で止まらないようページが行い、区画は数えの基準だけを置き直す
export function LiveMatchSection({
  product,
  viewer,
  page,
  autoRefresh,
  reportAutoUpdating,
}: ProductPageContext) {
  const queryClient = useQueryClient();
  const clientViewer = useViewer();
  const options = useMemo(
    () => productLiveMatchQueryOptions(clientViewer, product.handle),
    [clientViewer, product.handle],
  );
  const { queryKey } = options;
  const updateCountNow = (): number =>
    updateCountOf(queryClient.getQueryState(queryKey));
  const [baseline, setBaseline] = useState(updateCountNow);
  const { data } = useSuspenseQuery({
    ...options,
    ...LIVE_REFRESH_QUERY_OPTIONS,
    refetchInterval: (query) =>
      liveMatchRefetchIntervalOf({
        liveMatch: query.state.data?.productLiveMatch,
        autoRefresh,
        updatesSinceBaseline: updateCountOf(query.state) - baseline,
      }),
    refetchOnWindowFocus: (query) =>
      canLiveMatchChange(query.state.data?.productLiveMatch),
    refetchOnMount: false,
    // 値が変わらない取り直しや失敗も回数に数えて上限の案内を出すため、更新の日時と失敗の回数の変化でも描き直す
    notifyOnChangeProps: ['data', 'dataUpdatedAt', 'errorUpdateCount'],
  });
  const liveMatch = data.productLiveMatch;
  const match = heldLiveMatchOf(liveMatch);

  // ページが同じ境界の時刻に取り直すため、ここでは数えの基準だけを境界の時点の回数に置き直し、境界の取り直しを上限の回数の1回目に数える
  const resetBaseline = useCallback(() => {
    setBaseline(updateCountOf(queryClient.getQueryState(queryKey)));
  }, [queryClient, queryKey]);
  useBoundaryRefresh(
    liveMatchBoundariesOf(liveMatch, page.launches),
    resetBaseline,
  );

  // 開催中のマッチが替わった時は詳細ページを取り直す。確定・消失ではマッチ履歴に結果を出し、開始では日次のジョブより前の境界の取り直しで残ったキックオフ前の表示を替える。
  // キーのハンドルの大文字小文字がloaderと区画で違い得るため先頭で無効にする
  const heldMatchId = match?.id ?? null;
  const previousHeldMatchIdRef = useRef(heldMatchId);
  useEffect(() => {
    const previous = previousHeldMatchIdRef.current;
    previousHeldMatchIdRef.current = heldMatchId;
    if (previous !== heldMatchId) {
      void queryClient.invalidateQueries({
        queryKey: PRODUCT_PAGE_QUERY_PREFIX,
      });
    }
  }, [heldMatchId, queryClient]);

  const autoUpdating = hasLiveMatchAutoUpdates(liveMatch);
  useEffect(() => {
    reportAutoUpdating(autoUpdating);
  }, [autoUpdating, reportAutoUpdating]);

  const onUpdated = useCallback(
    (updated: MatchFragment) => {
      queryClient.setQueryData(queryKey, (current) =>
        withUpdatedLiveMatch(current, updated),
      );
    },
    [queryClient, queryKey],
  );

  const exhausted = isLiveMatchFollowUpExhausted({
    liveMatch,
    autoRefresh,
    updatesSinceBaseline: updateCountNow() - baseline,
  });
  const statusMessage = exhausted ? FOLLOW_UP_EXHAUSTED_MESSAGE : null;

  if (liveMatch === null || match === null) {
    if (liveMatch?.awaitingChange !== true) {
      return null;
    }
    // マッチの作成や開始を待つ間も上限の案内を伝えるため、文が加わった時に読み上げられる領域を置く。文が無い間は枠の間隔を残さない
    return (
      <p role="status" className="text-sm font-medium empty:sr-only">
        {statusMessage}
      </p>
    );
  }

  const isLive = match.phase === 'LIVE';
  return (
    <section aria-labelledby={LIVE_MATCH_HEADING_ID}>
      <SectionHeading
        id={LIVE_MATCH_HEADING_ID}
        icon={<LiveBadge />}
        title={liveMatchTitle(matchStageLabel(match))}
        meta={isLive ? descriptionFor(viewer.isOwner) : undefined}
      />
      {/* 文が加わった時に読み上げられるよう、文が無い間も領域を置いておく */}
      <p role="status" className="mt-2 text-sm font-medium empty:mt-0">
        {statusMessage}
      </p>
      <div className="mt-4 flex flex-col gap-3">
        <FullTimeCountdown
          phase={isLive ? 'LIVE' : 'RESULT'}
          fullTimeAt={match.endsAt}
          serverTime={liveMatch.serverTime}
          autoRefresh={autoRefresh}
        />
        <LiveMatchCard match={match} onUpdated={onUpdated} />
      </div>
    </section>
  );
}
