import type { RefObject } from 'react';

import { FormMessage } from '../../../lib/components/form/form-message.tsx';
import { PathLink } from '../../../lib/components/navigation/path-link.tsx';
import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { ErrorState } from '../../../lib/components/state/error-state.tsx';
import { LoadingSkeleton } from '../../../lib/components/state/loading-skeleton.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { Skeleton } from '../../../lib/components/ui/skeleton/skeleton.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { ApiKeyFieldsFragment } from '../../graphql/generated/graphql.ts';
import { useFollowListFocus } from '../profile/use-follow-list-focus.ts';
import {
  type ApiKeyActionRequest,
  type ApiKeyDisabledActions,
  ApiKeyListItem,
} from './api-key-list-item.tsx';
import {
  API_DOCS_HREF,
  API_KEY_LIST_MESSAGES,
} from './api-key-list-messages.ts';

export interface ApiKeyListProps {
  // undefinedの間は最初の読み込み中。サーバーが返す発行の新しい順のまま並べる
  readonly apiKeys: readonly ApiKeyFieldsFragment[] | undefined;
  // 最初の取得の失敗
  readonly loadFailed: boolean;
  readonly onRetry: () => void;
  // 再試行で消える再試行のボタンから、フォーカスを<body>へ落とさないための移り先(ページの見出しなど)
  readonly retryFocusRef: RefObject<HTMLElement | null>;
  readonly hasNextPage: boolean;
  readonly loadingMore: boolean;
  // 続きの読み込みの失敗。読み込んだ項目と「さらに表示」を残したまま示す
  readonly loadMoreError: Error | null;
  readonly onLoadMore: () => void;
  readonly disabledActions?: ApiKeyDisabledActions;
  readonly onAction: (request: ApiKeyActionRequest) => void;
}

const SKELETON_ITEMS = [0, 1, 2];

// 読み込んだ後の項目と同じ配置(名前と項目・操作)を保ち、表示が切り替わる時のずれを抑える
function ApiKeySkeletons() {
  return (
    <div className="flex flex-col gap-4">
      {SKELETON_ITEMS.map((item) => (
        <div
          key={item}
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:justify-between sm:p-5"
        >
          <div className="flex flex-1 flex-col gap-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-8 w-48" />
        </div>
      ))}
    </div>
  );
}

// 自分のAPIキーを発行の新しい順に示し、「さらに表示」で古いキーを後ろに加える。取得は呼び出し元が行い、状態を受け取って描く
export function ApiKeyList({
  apiKeys,
  loadFailed,
  onRetry,
  retryFocusRef,
  hasNextPage,
  loadingMore,
  loadMoreError,
  onLoadMore,
  disabledActions,
  onAction,
}: ApiKeyListProps) {
  const { listRef, loadMoreRef, rememberCount } = useFollowListFocus({
    entryCount: apiKeys?.length,
    loadingMore,
    loadMoreFailed: loadMoreError !== null,
  });

  if (loadFailed) {
    return (
      <ErrorState
        message={API_KEY_LIST_MESSAGES.loadError}
        onRetry={() => {
          retryFocusRef.current?.focus();
          onRetry();
        }}
      />
    );
  }
  if (apiKeys === undefined) {
    return (
      <LoadingSkeleton label={API_KEY_LIST_MESSAGES.loadingLabel}>
        <ApiKeySkeletons />
      </LoadingSkeleton>
    );
  }
  if (apiKeys.length === 0) {
    return (
      <EmptyState
        title={API_KEY_LIST_MESSAGES.emptyTitle}
        description={API_KEY_LIST_MESSAGES.emptyDescription}
        action={
          <Button asChild variant="outline">
            <PathLink href={API_DOCS_HREF}>
              {API_KEY_LIST_MESSAGES.apiDocsLink}
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
    rememberCount(apiKeys.length);
    onLoadMore();
  };
  const loadMoreFailed = loadMoreError !== null && !loadingMore;

  return (
    <div className="flex flex-col gap-4">
      <ul
        ref={listRef}
        aria-label={API_KEY_LIST_MESSAGES.listLabel}
        className="flex flex-col gap-4"
      >
        {apiKeys.map((apiKey) => (
          <ApiKeyListItem
            key={apiKey.id}
            apiKey={apiKey}
            disabledActions={disabledActions}
            onAction={onAction}
          />
        ))}
      </ul>
      {hasNextPage ? (
        <div className="flex flex-col items-center gap-3">
          {loadMoreFailed ? (
            <FormMessage role="alert">
              {errorMessageOf(loadMoreError, CLIENT_PROFILE.contactAvailable)}
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
              ? API_KEY_LIST_MESSAGES.loadingMore
              : API_KEY_LIST_MESSAGES.loadMore}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
