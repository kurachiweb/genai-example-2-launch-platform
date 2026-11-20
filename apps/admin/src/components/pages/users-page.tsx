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
  adminModerationUsersQueryOptions,
  toAdminModerationUserPage,
} from '../../graphql/admin-moderation-users.ts';
import { MODERATION_PAGE_COPY } from '../moderation/shared/moderation-messages.ts';
import {
  type UserModerationSearch,
  userModerationFilterScopeOf,
  userModerationListArgsOf,
  userModerationSearchAt,
} from '../moderation/shared/moderation-search.ts';
import { UserFilters } from '../moderation/users/user-filters.tsx';
import { UserTable } from '../moderation/users/user-table.tsx';

const routeApi = getRouteApi('/_authenticated/users/');

const COPY = MODERATION_PAGE_COPY.users;

export function UsersPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const users = useQuery({
    ...adminModerationUsersQueryOptions(userModerationListArgsOf(search)),
    select: toAdminModerationUserPage,
    placeholderData: keepPreviousData,
  });
  const [trail, setTrail] = useState(EMPTY_CURSOR_TRAIL);
  const scope = userModerationFilterScopeOf(search);
  const previous = previousPageOf(trail, scope, search.after);
  const refetching = users.isPlaceholderData;
  const nextCursor = refetching ? null : (users.data?.nextCursor ?? null);
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の取得のうちHTMLを送り始めた時点で終わっていなかったものの失敗は固定の文言の例外としてブラウザへ渡り、表示の後に取得し直した結果で文言を選び直すためでもある
  const failure = users.isFetching ? null : users.error;
  const show = (next: UserModerationSearch) => {
    void navigate({ search: next });
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader title={COPY.title} description={COPY.description} />
      <UserFilters
        search={search}
        onApply={show}
        onReset={() => {
          show({});
        }}
      />
      <UserTable
        rows={users.data?.items}
        {...(failure === null
          ? {}
          : {
              error: {
                message: errorMessageOf(
                  failure,
                  ADMIN_PROFILE.contactAvailable,
                ),
                onRetry: () => {
                  void users.refetch();
                },
              },
            })}
        refetching={refetching}
        pagination={{
          hasPrevious: previous.exists,
          hasNext: nextCursor !== null,
          onPrevious: () => {
            show(userModerationSearchAt(search, previous.after));
          },
          onNext: () => {
            if (nextCursor === null) {
              return;
            }
            setTrail(trailAfterNext(trail, scope, search.after, nextCursor));
            show(userModerationSearchAt(search, nextCursor));
          },
        }}
      />
    </div>
  );
}
