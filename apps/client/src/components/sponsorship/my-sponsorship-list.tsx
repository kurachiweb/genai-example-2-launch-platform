import { useInfiniteQuery } from '@tanstack/react-query';
import type { RefObject } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import {
  type MySponsorshipsData,
  mySponsorshipsQueryOptions,
} from '../../graphql/sponsorship.ts';
import { useFollowListFocus } from '../profile/use-follow-list-focus.ts';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import {
  type MySponsorship,
  MySponsorshipItem,
} from './my-sponsorship-item.tsx';
import {
  MY_SPONSORSHIPS_EMPTY_MESSAGE,
  MY_SPONSORSHIPS_LOAD_ERROR_MESSAGE,
  MY_SPONSORSHIPS_LOAD_MORE_LABEL,
  MY_SPONSORSHIPS_LOADING_MORE_LABEL,
  SPONSORSHIP_APPLY_HREF,
  SPONSORSHIP_APPLY_LINK_LABEL,
} from './sponsorship-messages.ts';

export interface MySponsorshipListProps {
  readonly viewerId: string;
  // 一覧の名前にするページの見出し
  readonly labelledBy: string;
  // 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないための移り先
  readonly retryFocusRef: RefObject<HTMLElement | null>;
}

interface MySponsorshipsView {
  readonly sponsorships: readonly MySponsorship[];
  // 次の基準時刻の0:00。掲載予定から掲載中・掲載中から終了へ切り替わる
  readonly nextDayStartsAt: string | null;
}

const toMySponsorshipsView = (
  data: MySponsorshipsData,
): MySponsorshipsView => ({
  sponsorships: data.pages.flatMap(
    ({ mySponsorships }) => mySponsorships.nodes,
  ),
  nextDayStartsAt: data.pages[0]?.mySponsorships.nextDayStartsAt ?? null,
});

const SKELETON_ITEMS = [0, 1, 2];

// 読み込んだ後の項目と同じ配置(ロゴ・名称とティア・掲載期間などの項目)を保ち、表示が切り替わる時のずれを抑える
function MySponsorshipSkeletons() {
  return (
    <div className="flex flex-col gap-4">
      {SKELETON_ITEMS.map((item) => (
        <div
          key={item}
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start sm:p-5"
        >
          <Skeleton className="size-16 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// 自分の申込を申込の新しい順に20件ずつ示し、「さらに表示」で続きを後ろに加える。取得の失敗は一覧の固定の文言にする
export function MySponsorshipList({
  viewerId,
  labelledBy,
  retryFocusRef,
}: MySponsorshipListProps) {
  const query = useInfiniteQuery({
    ...mySponsorshipsQueryOptions(viewerId),
    select: toMySponsorshipsView,
  });
  const view = query.data;
  const nextDayStartsAt = view?.nextDayStartsAt ?? null;
  useBoundaryRefresh(nextDayStartsAt === null ? [] : [nextDayStartsAt], () => {
    void query.refetch();
  });
  // 取得し直している間は前の失敗を示さず読み込み中にする
  const loadFailed = view === undefined && !query.isFetching && query.isError;
  const loadingMore = query.isFetchingNextPage;
  const loadMoreFailed = query.isFetchNextPageError && !loadingMore;
  const { listRef, loadMoreRef, rememberCount } = useFollowListFocus({
    entryCount: view?.sponsorships.length,
    loadingMore,
    loadMoreFailed: query.isFetchNextPageError,
  });

  if (loadFailed) {
    return (
      <PartialErrorState
        message={MY_SPONSORSHIPS_LOAD_ERROR_MESSAGE}
        onRetry={() => {
          retryFocusRef.current?.focus();
          void query.refetch();
        }}
      />
    );
  }
  if (view === undefined) {
    return (
      <LoadingSkeleton>
        <MySponsorshipSkeletons />
      </LoadingSkeleton>
    );
  }
  const { sponsorships } = view;
  if (sponsorships.length === 0) {
    return (
      <EmptyState
        title={MY_SPONSORSHIPS_EMPTY_MESSAGE}
        action={
          <Button asChild>
            <PathLink href={SPONSORSHIP_APPLY_HREF}>
              {SPONSORSHIP_APPLY_LINK_LABEL}
            </PathLink>
          </Button>
        }
      />
    );
  }

  const loadMore = () => {
    if (loadingMore) {
      return;
    }
    rememberCount(sponsorships.length);
    void query.fetchNextPage();
  };

  return (
    <div className="flex flex-col gap-4">
      <ul
        ref={listRef}
        aria-labelledby={labelledBy}
        className="flex flex-col gap-4"
      >
        {sponsorships.map((sponsorship) => (
          <MySponsorshipItem
            key={sponsorship.id}
            sponsorship={sponsorship}
            onStale={() => {
              void query.refetch();
            }}
          />
        ))}
      </ul>
      {query.hasNextPage ? (
        <div className="flex flex-col items-center gap-3">
          {loadMoreFailed ? (
            <FormMessage role="alert">
              {MY_SPONSORSHIPS_LOAD_ERROR_MESSAGE}
            </FormMessage>
          ) : null}
          <Button
            ref={loadMoreRef}
            type="button"
            variant="outline"
            aria-disabled={loadingMore || undefined}
            aria-busy={loadingMore || undefined}
            onClick={loadMore}
          >
            {loadingMore
              ? MY_SPONSORSHIPS_LOADING_MORE_LABEL
              : MY_SPONSORSHIPS_LOAD_MORE_LABEL}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
