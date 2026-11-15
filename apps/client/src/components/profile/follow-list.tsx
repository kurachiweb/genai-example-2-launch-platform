import { useInfiniteQuery } from '@tanstack/react-query';
import type { RefObject } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../lib/components/state/partial-error-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  type FollowListDirection,
  followListQueryOptions,
  toFollowListEntries,
} from '../../graphql/follow-list.ts';
import { FollowListItem } from './follow-list-item.tsx';
import {
  FOLLOW_LIST_EMPTY_MESSAGES,
  FOLLOW_LIST_LOAD_MORE_LABEL,
  FOLLOW_LIST_LOAD_MORE_PENDING_LABEL,
} from './follow-list-messages.ts';
import { ProfileListItemSkeletons } from './profile-list-item-skeletons.tsx';
import { useFollowListFocus } from './use-follow-list-focus.ts';

export interface FollowListProps {
  readonly viewerId: string;
  readonly direction: FollowListDirection;
  // 再試行で消える再試行のボタンからフォーカスを<body>へ落とさないための移り先
  readonly retryFocusRef: RefObject<HTMLElement | null>;
}

// ログイン中の利用者のフォロー中・フォロワーを新しい順に20件ずつ示し、「さらに読み込む」で古い項目を後ろに加える。タブごとに呼び出し側でkeyを替え、前のタブの状態を持ち越さない
export function FollowList({
  viewerId,
  direction,
  retryFocusRef,
}: FollowListProps) {
  const query = useInfiniteQuery({
    ...followListQueryOptions(viewerId, direction),
    select: toFollowListEntries,
  });
  const entries = query.data;
  // 取得し直している間は前の失敗を示さず読み込み中にする
  const loadError =
    entries === undefined && !query.isFetching ? query.error : null;
  const loadingMore = query.isFetchingNextPage;
  const loadMoreError =
    query.isFetchNextPageError && !loadingMore ? query.error : null;
  const { listRef, loadMoreRef, rememberCount } = useFollowListFocus({
    entryCount: entries?.length,
    loadingMore,
    loadMoreFailed: query.isFetchNextPageError,
  });

  if (loadError !== null) {
    return (
      <PartialErrorState
        message={errorMessageOf(loadError, CLIENT_PROFILE.contactAvailable)}
        onRetry={() => {
          retryFocusRef.current?.focus();
          void query.refetch();
        }}
      />
    );
  }
  if (entries === undefined) {
    return (
      <LoadingSkeleton>
        <ProfileListItemSkeletons />
      </LoadingSkeleton>
    );
  }
  if (entries.length === 0) {
    return <EmptyState title={FOLLOW_LIST_EMPTY_MESSAGES[direction]} />;
  }

  const loadMore = () => {
    if (loadingMore) {
      return;
    }
    rememberCount(entries.length);
    void query.fetchNextPage();
  };

  return (
    <div className="flex flex-col gap-4">
      <ul ref={listRef} className="flex flex-col gap-3">
        {entries.map((entry) => (
          <FollowListItem
            key={entry.handle}
            entry={entry}
            direction={direction}
          />
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
              ? FOLLOW_LIST_LOAD_MORE_PENDING_LABEL
              : FOLLOW_LIST_LOAD_MORE_LABEL}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
