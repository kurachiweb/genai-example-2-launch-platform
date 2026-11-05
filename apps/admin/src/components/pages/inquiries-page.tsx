import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
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
  adminInquiriesQueryOptions,
  adminInquiryCategoryOptionsQueryOptions,
  toAdminInquiryListPage,
  toInquiryCategoryOptions,
} from '../../graphql/admin-inquiries.ts';
import {
  INQUIRIES_DESCRIPTION,
  INQUIRIES_TITLE,
} from '../inquiry/admin-inquiries-messages.ts';
import { AdminInquiryFilters } from '../inquiry/admin-inquiry-filters.tsx';
import { AdminInquiryList } from '../inquiry/admin-inquiry-list.tsx';
import {
  type AdminInquirySearch,
  adminInquiryFilterScopeOf,
  adminInquirySearchAt,
  adminInquiryVariablesOf,
} from '../inquiry/admin-inquiry-search.ts';

const routeApi = getRouteApi('/_authenticated/inquiries/');

export function InquiriesPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  // 期間の境界は一覧の日時の表示と同じ地域の暦で決める
  const { timeZone } = useDisplayPreferences();
  const { data: categories } = useSuspenseQuery({
    ...adminInquiryCategoryOptionsQueryOptions(),
    select: toInquiryCategoryOptions,
  });
  const inquiries = useQuery({
    ...adminInquiriesQueryOptions(adminInquiryVariablesOf(search, timeZone)),
    select: toAdminInquiryListPage,
  });
  const [trail, setTrail] = useState(EMPTY_CURSOR_TRAIL);
  const scope = adminInquiryFilterScopeOf(search);
  const previous = previousPageOf(trail, scope, search.after);
  const nextCursor = inquiries.data?.nextCursor ?? null;
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の取得のうちHTMLを送り始めた時点で終わっていなかったものの失敗は固定の文言の例外としてブラウザへ渡り、表示の後に取得し直した結果で文言を選び直すためでもある
  const failure = inquiries.isFetching ? null : inquiries.error;
  const show = (next: AdminInquirySearch) => {
    void navigate({ search: next });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={INQUIRIES_TITLE}
        description={INQUIRIES_DESCRIPTION}
      />
      <AdminInquiryFilters
        search={search}
        categories={categories}
        onApply={show}
        onReset={() => {
          show({});
        }}
      />
      <AdminInquiryList
        entries={inquiries.data?.entries}
        {...(failure === null
          ? {}
          : {
              error: {
                message: errorMessageOf(
                  failure,
                  ADMIN_PROFILE.contactAvailable,
                ),
                onRetry: () => {
                  void inquiries.refetch();
                },
              },
            })}
        pagination={{
          hasPrevious: previous.exists,
          hasNext: nextCursor !== null,
          onPrevious: () => {
            show(adminInquirySearchAt(search, previous.after));
          },
          onNext: () => {
            if (nextCursor === null) {
              return;
            }
            setTrail(trailAfterNext(trail, scope, search.after, nextCursor));
            show(adminInquirySearchAt(search, nextCursor));
          },
        }}
      />
    </div>
  );
}
