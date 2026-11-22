import { useInfiniteQuery } from '@tanstack/react-query';
import { type RefObject, useState } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { LIVE_REFRESH_QUERY_OPTIONS } from '../../../lib/utilities/query/live-refresh.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import { myDataExportsQueryOptions } from '../../graphql/data-export.ts';
import { AutoRefreshSwitch } from '../match/auto-refresh-switch.tsx';
import { useFollowListFocus } from '../profile/use-follow-list-focus.ts';
import {
  dataExportRefetchInterval,
  hasPendingDataExport,
  toDataExports,
} from './data-export-entries.ts';
import { DataExportItem } from './data-export-item.tsx';
import {
  DATA_EXPORT_AUTO_REFRESH_DESCRIPTION,
  DATA_EXPORT_EMPTY_MESSAGE,
  DATA_EXPORT_LOAD_ERROR_MESSAGE,
  DATA_EXPORT_LOAD_MORE_LABEL,
  DATA_EXPORT_LOADING_MORE_LABEL,
} from './data-export-messages.ts';

export interface DataExportListProps {
  readonly viewerId: string;
  // 一覧の名前にするページの見出し
  readonly labelledBy: string;
  // 再試行で消える再試行のボタンから、フォーカスを<body>へ落とさないための移り先
  readonly retryFocusRef: RefObject<HTMLElement | null>;
}

const SKELETON_ITEMS = [0, 1, 2];

// 読み込んだ後の項目と同じ配置(状態と項目の組)を保ち、表示が切り替わる時のずれを抑える
function DataExportSkeletons() {
  return (
    <div className="flex flex-col gap-3">
      {SKELETON_ITEMS.map((item) => (
        <div
          key={item}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3"
        >
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

// 自分のエクスポートの要求を要求日時の新しい順に20件ずつ示し、「さらに表示」で続きを後ろに加える。作成中の要求がある間だけ、読み込んだページを定期再取得の間隔で取り直す
export function DataExportList({
  viewerId,
  labelledBy,
  retryFocusRef,
}: DataExportListProps) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  // 表示する前にloaderが取得しているため、表示した時点では取り直さず、loaderの取得とハイドレーションの直後の取得を重ねない
  const query = useInfiniteQuery({
    ...myDataExportsQueryOptions(viewerId),
    ...LIVE_REFRESH_QUERY_OPTIONS,
    refetchInterval: dataExportRefetchInterval(autoRefresh),
    refetchOnWindowFocus: (current) => hasPendingDataExport(current.state.data),
    refetchOnMount: false,
    select: toDataExports,
  });
  const exportItems = query.data;
  // 取得し直している間は前の失敗を示さず読み込み中にする
  const loadFailed =
    exportItems === undefined && !query.isFetching && query.isError;
  const loadingMore = query.isFetchingNextPage;
  const loadMoreError =
    query.isFetchNextPageError && !loadingMore ? query.error : null;
  const { listRef, loadMoreRef, rememberCount } = useFollowListFocus({
    entryCount: exportItems?.length,
    loadingMore,
    loadMoreFailed: query.isFetchNextPageError,
  });

  if (loadFailed) {
    return (
      <PartialErrorState
        message={DATA_EXPORT_LOAD_ERROR_MESSAGE}
        onRetry={() => {
          retryFocusRef.current?.focus();
          void query.refetch();
        }}
      />
    );
  }
  if (exportItems === undefined) {
    return (
      <LoadingSkeleton>
        <DataExportSkeletons />
      </LoadingSkeleton>
    );
  }
  if (exportItems.length === 0) {
    return <EmptyState title={DATA_EXPORT_EMPTY_MESSAGE} />;
  }

  const loadMore = () => {
    if (loadingMore) {
      return;
    }
    rememberCount(exportItems.length);
    void query.fetchNextPage();
  };
  const hasPending = exportItems.some(({ status }) => status === 'PENDING');

  return (
    <div className="flex flex-col gap-4">
      {hasPending ? (
        <div className="flex justify-end">
          <AutoRefreshSwitch
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
            description={DATA_EXPORT_AUTO_REFRESH_DESCRIPTION}
          />
        </div>
      ) : null}
      <ul
        ref={listRef}
        aria-labelledby={labelledBy}
        className="flex flex-col gap-3"
      >
        {exportItems.map((item) => (
          <DataExportItem key={item.id} item={item} />
        ))}
      </ul>
      {query.hasNextPage ? (
        <div className="flex flex-col items-center gap-3">
          {loadMoreError === null ? null : (
            <FormMessage role="alert">
              {errorMessageOf(loadMoreError, CLIENT_PROFILE.contactAvailable)}
            </FormMessage>
          )}
          <Button
            ref={loadMoreRef}
            type="button"
            variant="outline"
            aria-disabled={loadingMore || undefined}
            aria-busy={loadingMore || undefined}
            onClick={loadMore}
          >
            {loadingMore
              ? DATA_EXPORT_LOADING_MORE_LABEL
              : DATA_EXPORT_LOAD_MORE_LABEL}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
