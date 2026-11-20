import { useInfiniteQuery } from '@tanstack/react-query';
import { useId } from 'react';

import { hasRole } from '../../../../common-lib/admin/admin-roles.ts';
import {
  AdminDataTable,
  type AdminDataTableColumn,
} from '../../../../lib/components/admin/admin-data-table.tsx';
import { DateTime } from '../../../../lib/components/datetime/date-time.tsx';
import { FormMessage } from '../../../../lib/components/form/form-message.tsx';
import { Button } from '../../../../lib/components/ui/button/button.tsx';
import { errorMessageOf } from '../../../../lib/utilities/graphql/graphql-result.ts';
import { LOADING_LABEL } from '../../../../lib/utilities/messages/state-messages.ts';
import { ADMIN_PROFILE } from '../../../composition/app-profile.ts';
import {
  adminProductRatingsQueryOptions,
  type AdminModerationRatingView,
  toAdminProductRatings,
} from '../../../graphql/admin-moderation-engagement.ts';
import type { AdminModerationProductDetailView } from '../../../graphql/admin-moderation-products.ts';
import { useAdminRole } from '../../layout/use-current-admin.ts';
import { RatingModerationActions } from '../ratings/rating-moderation-actions.tsx';
import {
  LOAD_MORE_LABEL,
  NO_VALID_RATINGS_MESSAGE,
  PRODUCT_DETAIL_COPY,
  PRODUCT_RATING_LIST_CAPTION,
  PRODUCT_RATING_LIST_COLUMNS,
  productOwnerLabel,
  RATING_STATE_LABELS,
  ratingScoreLabel,
  ratingSummaryText,
  UNREADABLE_USER_LABEL,
} from '../shared/moderation-messages.ts';
import { useAppendedRowFocus } from './use-appended-row-focus.ts';

export interface ProductRatingsPanelProps {
  readonly productId: string;
  readonly summary: AdminModerationProductDetailView['ratingSummary'];
}

const BASE_COLUMNS: readonly AdminDataTableColumn<AdminModerationRatingView>[] =
  Object.freeze([
    {
      key: 'rater',
      header: PRODUCT_RATING_LIST_COLUMNS.rater,
      className: 'wrap-anywhere whitespace-normal',
      cell: ({ rater }) =>
        rater === null
          ? UNREADABLE_USER_LABEL
          : productOwnerLabel(rater.nickname, rater.handle),
    },
    {
      key: 'score',
      header: PRODUCT_RATING_LIST_COLUMNS.score,
      cell: ({ score }) => (
        <>
          <span aria-hidden="true">{score}</span>
          <span className="sr-only">{ratingScoreLabel(score)}</span>
        </>
      ),
    },
    {
      key: 'updatedAt',
      header: PRODUCT_RATING_LIST_COLUMNS.updatedAt,
      cell: ({ updatedAt }) => (
        <DateTime value={updatedAt} format="longDateTime" />
      ),
    },
    {
      key: 'state',
      header: PRODUCT_RATING_LIST_COLUMNS.state,
      cell: ({ state }) => RATING_STATE_LABELS[state],
    },
  ]);

const ACTIONS_COLUMN: AdminDataTableColumn<AdminModerationRatingView> =
  Object.freeze({
    key: 'actions',
    header: PRODUCT_RATING_LIST_COLUMNS.actions,
    cell: (rating: AdminModerationRatingView) => (
      <RatingModerationActions rating={rating} />
    ),
  });

const summaryTextOf = ({
  average,
  count,
}: ProductRatingsPanelProps['summary']): string =>
  average === null || count === 0
    ? NO_VALID_RATINGS_MESSAGE
    : ratingSummaryText(average, count);

// 有効な評価の平均と件数と、評価の一覧を更新日時の新しい順に示し、続きは後ろに読み足す。最初の取得の失敗は一覧の位置で、続きの読み込みの失敗はボタンの近くで示し、この区画の中で読み込み直せる
export function ProductRatingsPanel({
  productId,
  summary,
}: ProductRatingsPanelProps) {
  const headingId = useId();
  const canModerate = hasRole(useAdminRole(), 'moderator');
  const ratings = useInfiniteQuery({
    ...adminProductRatingsQueryOptions(productId),
    select: toAdminProductRatings,
  });
  const rows = ratings.data;
  // 取得し直している間は前の失敗を示さず読み込み中にする。表示中の行がある時の取り直しの失敗は行を残す
  const loadError =
    rows === undefined && !ratings.isFetching ? ratings.error : null;
  const loadingMore = ratings.isFetchingNextPage;
  const loadMoreError =
    ratings.isFetchNextPageError && !loadingMore ? ratings.error : null;
  const { tableRef, loadMoreRef, rememberCount } = useAppendedRowFocus({
    rowCount: rows?.length,
    loadingMore,
    loadMoreFailed: ratings.isFetchNextPageError,
  });
  const columns = canModerate
    ? [...BASE_COLUMNS, ACTIONS_COLUMN]
    : BASE_COLUMNS;

  const loadMore = () => {
    if (loadingMore || rows === undefined) {
      return;
    }
    rememberCount(rows.length);
    void ratings.fetchNextPage();
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <h2 id={headingId} className="text-lg font-extrabold">
        {PRODUCT_DETAIL_COPY.sections.ratings}
      </h2>
      <p className="text-sm font-bold">{summaryTextOf(summary)}</p>
      {loadError === null && rows?.length === 0 ? null : (
        <div ref={tableRef}>
          <AdminDataTable
            caption={PRODUCT_RATING_LIST_CAPTION}
            columns={columns}
            rows={rows}
            rowKey={({ id }) => id}
            emptyMessage={NO_VALID_RATINGS_MESSAGE}
            {...(loadError === null
              ? {}
              : {
                  error: {
                    message: errorMessageOf(
                      loadError,
                      ADMIN_PROFILE.contactAvailable,
                    ),
                    onRetry: () => {
                      void ratings.refetch();
                    },
                  },
                })}
          />
        </div>
      )}
      {rows !== undefined && ratings.hasNextPage ? (
        <div className="flex flex-col items-center gap-3">
          {loadMoreError === null ? null : (
            <FormMessage role="alert">
              {errorMessageOf(loadMoreError, ADMIN_PROFILE.contactAvailable)}
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
    </section>
  );
}
