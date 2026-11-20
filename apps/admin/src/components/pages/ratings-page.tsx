import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  EMPTY_CURSOR_TRAIL,
  previousPageOf,
  trailAfterNext,
} from '../../../lib/utilities/pagination/cursor-trail.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminModerationRatingsQueryOptions,
  toAdminModerationRatingPage,
} from '../../graphql/admin-moderation-engagement.ts';
import { RatingFilters } from '../moderation/ratings/rating-filters.tsx';
import { RatingTable } from '../moderation/ratings/rating-table.tsx';
import { MODERATION_PAGE_COPY } from '../moderation/shared/moderation-messages.ts';
import {
  type RatingModerationSearch,
  ratingModerationFilterScopeOf,
  ratingModerationListArgsOf,
  ratingModerationSearchAt,
} from '../moderation/shared/moderation-search.ts';

const routeApi = getRouteApi('/_authenticated/ratings/');

const COPY = MODERATION_PAGE_COPY.ratings;

export function RatingsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const ratings = useQuery({
    ...adminModerationRatingsQueryOptions(ratingModerationListArgsOf(search)),
    select: toAdminModerationRatingPage,
    placeholderData: keepPreviousData,
  });
  const [trail, setTrail] = useState(EMPTY_CURSOR_TRAIL);
  const scope = ratingModerationFilterScopeOf(search);
  const previous = previousPageOf(trail, scope, search.after);
  const refetching = ratings.isPlaceholderData;
  const nextCursor = refetching ? null : (ratings.data?.nextCursor ?? null);
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の取得のうちHTMLを送り始めた時点で終わっていなかったものの失敗は固定の文言の例外としてブラウザへ渡り、表示の後に取得し直した結果で文言を選び直すためでもある
  const failure = ratings.isFetching ? null : ratings.error;
  // 条件の変更では利用者が操作した絞り込みの位置に留め、ページの移動のスクロールとフォーカスは一覧の側で移す
  const show = (next: RatingModerationSearch) => {
    void navigate({ search: next, resetScroll: false });
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader title={COPY.title} description={COPY.description} />
      <RatingFilters
        search={search}
        onApply={show}
        onReset={() => {
          show({});
        }}
      />
      <RatingTable
        rows={ratings.data?.items}
        {...(failure === null
          ? {}
          : {
              error: {
                message: errorMessageOf(
                  failure,
                  ADMIN_PROFILE.contactAvailable,
                ),
                onRetry: () => {
                  void ratings.refetch();
                },
              },
            })}
        refetching={refetching}
        pagination={{
          hasPrevious: previous.exists,
          hasNext: nextCursor !== null,
          onPrevious: () => {
            show(ratingModerationSearchAt(search, previous.after));
          },
          onNext: () => {
            if (nextCursor === null) {
              return;
            }
            setTrail(trailAfterNext(trail, scope, search.after, nextCursor));
            show(ratingModerationSearchAt(search, nextCursor));
          },
        }}
      />
    </div>
  );
}
