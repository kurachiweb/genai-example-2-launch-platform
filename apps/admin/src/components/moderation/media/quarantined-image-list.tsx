import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { type RefObject, useLayoutEffect, useRef } from 'react';

import type { QuarantineReason } from '../../../../common-lib/moderation/moderation-labels.ts';
import { FormMessage } from '../../../../lib/components/form/form-message.tsx';
import { EmptyState } from '../../../../lib/components/state/empty-state.tsx';
import { LoadingSkeleton } from '../../../../lib/components/state/loading-skeleton.tsx';
import { PartialErrorState } from '../../../../lib/components/state/partial-error-state.tsx';
import { Button } from '../../../../lib/components/ui/button/button.tsx';
import { cn } from '../../../../lib/utilities/class-names.ts';
import { errorMessageOf } from '../../../../lib/utilities/graphql/graphql-result.ts';
import { LOADING_LABEL } from '../../../../lib/utilities/messages/state-messages.ts';
import { ADMIN_PROFILE } from '../../../composition/app-profile.ts';
import {
  adminQuarantinedImagesQueryOptions,
  toAdminQuarantinedImages,
} from '../../../graphql/admin-quarantined-images.ts';
import {
  LOAD_MORE_LABEL,
  QUARANTINED_IMAGE_LIST_CAPTION,
  QUARANTINED_IMAGE_LIST_EMPTY_MESSAGE,
} from '../shared/moderation-messages.ts';
import { QuarantinedImageCard } from './quarantined-image-card.tsx';
import { useAppendedImageFocus } from './use-appended-image-focus.ts';

export interface QuarantinedImageListProps {
  readonly reason: QuarantineReason;
  // 再試行の後に消える操作からフォーカスを<body>へ落とさないための移り先
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

const failureMessageOf = (error: unknown): string =>
  errorMessageOf(error, ADMIN_PROFILE.contactAvailable);

// 選んだ隔離理由の画像を隔離された日時の新しい順に示し、「さらに読み込む」で古い項目を後ろに加える。理由を切り替えて取り直す間は前の一覧を操作できないまま残す
export function QuarantinedImageList({
  reason,
  returnFocusRef,
}: QuarantinedImageListProps) {
  const images = useInfiniteQuery({
    ...adminQuarantinedImagesQueryOptions(reason),
    select: toAdminQuarantinedImages,
    placeholderData: keepPreviousData,
  });
  const items = images.data;
  const refetching = images.isPlaceholderData;
  // 取得し直している間は前の失敗を示さず読み込み中にする。表示中の項目がある時の取り直しの失敗は項目を残す
  const loadError =
    items === undefined && !images.isFetching ? images.error : null;
  const loadingMore = images.isFetchingNextPage;
  const loadMoreError =
    images.isFetchNextPageError && !loadingMore ? images.error : null;
  const { listRef, loadMoreRef, rememberCount } = useAppendedImageFocus({
    itemCount: items?.length,
    loadingMore,
    loadMoreFailed: images.isFetchNextPageError,
  });
  const errorRef = useRef<HTMLDivElement>(null);
  const retryingRef = useRef(false);
  // 再試行がもう一度失敗すると、押した再試行のボタンは描き直されて消えるため、移り先の区画に残るフォーカスを新しい再試行のボタンへ移す
  useLayoutEffect(() => {
    if (!retryingRef.current || images.isFetching) {
      return;
    }
    retryingRef.current = false;
    if (
      loadError !== null &&
      document.activeElement === returnFocusRef.current
    ) {
      errorRef.current?.querySelector('button')?.focus();
    }
  }, [loadError, images.isFetching, returnFocusRef]);

  if (loadError !== null) {
    return (
      <PartialErrorState
        ref={errorRef}
        message={failureMessageOf(loadError)}
        onRetry={() => {
          retryingRef.current = true;
          returnFocusRef.current?.focus();
          void images.refetch();
        }}
      />
    );
  }
  if (items === undefined) {
    return <LoadingSkeleton />;
  }

  const loadMore = () => {
    if (loadingMore) {
      return;
    }
    rememberCount(items.length);
    void images.fetchNextPage();
  };

  return (
    <div
      aria-busy={refetching || undefined}
      inert={refetching}
      className={cn(
        'flex flex-col gap-4',
        refetching && 'opacity-45 saturate-50',
      )}
    >
      {items.length === 0 ? (
        <EmptyState title={QUARANTINED_IMAGE_LIST_EMPTY_MESSAGE} />
      ) : (
        <ul
          ref={listRef}
          aria-label={QUARANTINED_IMAGE_LIST_CAPTION}
          className="flex flex-col gap-4"
        >
          {items.map((image) => (
            <QuarantinedImageCard key={image.file.id} image={image} />
          ))}
        </ul>
      )}
      {images.hasNextPage && !refetching ? (
        <div className="flex flex-col items-center gap-3">
          {loadMoreError === null ? null : (
            <FormMessage role="alert">
              {failureMessageOf(loadMoreError)}
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
            {loadingMore ? LOADING_LABEL : LOAD_MORE_LABEL}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
