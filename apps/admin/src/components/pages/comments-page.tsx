import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { errorMessageOf } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  EMPTY_CURSOR_TRAIL,
  previousPageOf,
  trailAfterNext,
} from '../../../lib/utilities/pagination/cursor-trail.ts';
import { ADMIN_PROFILE } from '../../composition/app-profile.ts';
import {
  adminModerationCommentsQueryOptions,
  toAdminModerationCommentPage,
} from '../../graphql/admin-moderation-engagement.ts';
import { CommentFilters } from '../moderation/comments/comment-filters.tsx';
import { CommentTable } from '../moderation/comments/comment-table.tsx';
import { MODERATION_PAGE_COPY } from '../moderation/shared/moderation-messages.ts';
import {
  type CommentModerationSearch,
  commentModerationFilterScopeOf,
  commentModerationListArgsOf,
  commentModerationSearchAt,
} from '../moderation/shared/moderation-search.ts';

const routeApi = getRouteApi('/_authenticated/comments/');

const COPY = MODERATION_PAGE_COPY.comments;

export function CommentsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  // 投稿日の期間の境界は一覧の日時の表示と同じ地域の暦で決める
  const { timeZone } = useDisplayPreferences();
  const comments = useQuery({
    ...adminModerationCommentsQueryOptions(
      commentModerationListArgsOf(search, timeZone),
    ),
    select: toAdminModerationCommentPage,
    placeholderData: keepPreviousData,
  });
  const [trail, setTrail] = useState(EMPTY_CURSOR_TRAIL);
  const scope = commentModerationFilterScopeOf(search);
  const previous = previousPageOf(trail, scope, search.after);
  const refetching = comments.isPlaceholderData;
  const nextCursor = refetching ? null : (comments.data?.nextCursor ?? null);
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の取得のうちHTMLを送り始めた時点で終わっていなかったものの失敗は固定の文言の例外としてブラウザへ渡り、表示の後に取得し直した結果で文言を選び直すためでもある
  const failure = comments.isFetching ? null : comments.error;
  // 条件の変更では利用者が操作した絞り込みの位置に留め、ページの移動のスクロールとフォーカスは一覧の側で移す
  const show = (next: CommentModerationSearch) => {
    void navigate({ search: next, resetScroll: false });
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader title={COPY.title} description={COPY.description} />
      <CommentFilters
        search={search}
        onApply={show}
        onReset={() => {
          show({});
        }}
      />
      <CommentTable
        rows={comments.data?.items}
        {...(failure === null
          ? {}
          : {
              error: {
                message: errorMessageOf(
                  failure,
                  ADMIN_PROFILE.contactAvailable,
                ),
                onRetry: () => {
                  void comments.refetch();
                },
              },
            })}
        refetching={refetching}
        pagination={{
          hasPrevious: previous.exists,
          hasNext: nextCursor !== null,
          onPrevious: () => {
            show(commentModerationSearchAt(search, previous.after));
          },
          onNext: () => {
            if (nextCursor === null) {
              return;
            }
            setTrail(trailAfterNext(trail, scope, search.after, nextCursor));
            show(commentModerationSearchAt(search, nextCursor));
          },
        }}
      />
    </div>
  );
}
