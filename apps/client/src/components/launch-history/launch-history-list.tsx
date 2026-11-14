import { useSuspenseInfiniteQuery } from '@tanstack/react-query';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import {
  launchHistoryQueryOptions,
  toLaunchHistoryView,
} from '../../graphql/launch-history.ts';
import type { ClientViewer } from '../../graphql/viewer.ts';
import { NEW_PRODUCT_HREF } from '../layout/site-links.ts';
import { NEW_PRODUCT_LABEL } from '../product/my-product-messages.ts';
import { useFollowListFocus } from '../profile/use-follow-list-focus.ts';
import { LaunchHistoryItem } from './launch-history-item.tsx';
import {
  LAUNCH_HISTORY_EMPTY_OWNER_DESCRIPTION,
  LAUNCH_HISTORY_EMPTY_TITLE,
  LAUNCH_HISTORY_LOAD_MORE_ERROR,
  LAUNCH_HISTORY_LOAD_MORE_LABEL,
  LAUNCH_HISTORY_LOAD_MORE_PENDING_LABEL,
  UNLISTED_PRODUCTS_NOTICE,
} from './launch-history-messages.ts';

export interface LaunchHistoryListProps {
  readonly viewer: ClientViewer | null;
  readonly handle: string;
}

// 読み込み中と最初の取得の失敗は呼び出し側の境界が示す。プロダクトを最新のローンチ日が新しい順に20件ずつ示し、「さらに読み込む」で続きを後ろに加える
export function LaunchHistoryList({ viewer, handle }: LaunchHistoryListProps) {
  const query = useSuspenseInfiniteQuery({
    ...launchHistoryQueryOptions(viewer, handle),
    select: toLaunchHistoryView,
  });
  const view = query.data;
  const items = view?.items ?? [];
  const loadingMore = query.isFetchingNextPage;
  const loadMoreFailed = query.isFetchNextPageError && !loadingMore;
  const { listRef, loadMoreRef, rememberCount } = useFollowListFocus({
    entryCount: items.length,
    loadingMore,
    loadMoreFailed: query.isFetchNextPageError,
  });

  // 利用者を表示できない(null)時は、他人の0件と同じく事実だけを示す
  if (view === null || items.length === 0) {
    const guided = view !== null && view.viewerIsOwner && !view.ownerSuspended;
    return (
      <EmptyState
        title={LAUNCH_HISTORY_EMPTY_TITLE}
        description={
          guided ? LAUNCH_HISTORY_EMPTY_OWNER_DESCRIPTION : undefined
        }
        action={
          guided ? (
            <Button asChild>
              <PathLink href={NEW_PRODUCT_HREF}>{NEW_PRODUCT_LABEL}</PathLink>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const loadMore = () => {
    if (loadingMore) {
      return;
    }
    rememberCount(items.length);
    void query.fetchNextPage();
  };

  return (
    <div className="flex flex-col gap-4">
      {view.hasUnlistedOwnProduct && !view.ownerSuspended && (
        <p className="text-sm text-muted-foreground">
          {UNLISTED_PRODUCTS_NOTICE}
        </p>
      )}
      <ul ref={listRef} className="flex flex-col gap-4">
        {items.map((item) => (
          // 続きを読み込んだ後に、加えた最初の項目へフォーカスを移せるよう、プログラムからだけフォーカスできるようにする
          <li key={item.product.handle} tabIndex={-1} className="rounded-xl">
            <LaunchHistoryItem
              item={item}
              viewerIsOwner={view.viewerIsOwner}
              ownerSuspended={view.ownerSuspended}
            />
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <div className="flex flex-col items-center gap-3">
          {loadMoreFailed && (
            <FormMessage role="alert">
              {LAUNCH_HISTORY_LOAD_MORE_ERROR}
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
              ? LAUNCH_HISTORY_LOAD_MORE_PENDING_LABEL
              : LAUNCH_HISTORY_LOAD_MORE_LABEL}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
