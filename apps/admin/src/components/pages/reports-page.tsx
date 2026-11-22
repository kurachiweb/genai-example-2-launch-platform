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
  adminReportCasesQueryOptions,
  toReportCasePage,
} from '../../graphql/admin-reporting-cases.ts';
import {
  adminReportCategoriesQueryOptions,
  toReportCategoryOptions,
} from '../../graphql/admin-reporting-categories.ts';
import { ReportCaseFilters } from '../reporting/list/report-case-filters.tsx';
import { ReportCaseTable } from '../reporting/list/report-case-table.tsx';
import { REPORTS_PAGE_COPY } from '../reporting/shared/report-messages.ts';
import {
  type ReportSearch,
  reportCaseFilterScopeOf,
  reportCaseListArgsOf,
  reportCaseSearchAt,
} from '../reporting/shared/report-search.ts';

const routeApi = getRouteApi('/_authenticated/reports/');

const NO_CATEGORIES: readonly [] = Object.freeze([]);

export function ReportsPage() {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  // 受付日の期間の境界は一覧の日時の表示と同じ地域の暦で決める
  const { timeZone } = useDisplayPreferences();
  const cases = useQuery({
    ...adminReportCasesQueryOptions(reportCaseListArgsOf(search, timeZone)),
    select: toReportCasePage,
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    ...adminReportCategoriesQueryOptions(),
    select: toReportCategoryOptions,
  });
  const [trail, setTrail] = useState(EMPTY_CURSOR_TRAIL);
  const scope = reportCaseFilterScopeOf(search);
  const previous = previousPageOf(trail, scope, search.after);
  const refetching = cases.isPlaceholderData;
  const nextCursor = refetching ? null : (cases.data?.nextCursor ?? null);
  // 取得し直している間は前の失敗を示さず読み込み中にする。描画中の取得のうちHTMLを送り始めた時点で終わっていなかったものの失敗は固定の文言の例外としてブラウザへ渡り、表示の後に取得し直した結果で文言を選び直すためでもある
  const failure = cases.isFetching ? null : cases.error;
  // 条件の変更では利用者が操作した絞り込みの位置に留め、ページの移動のスクロールとフォーカスは一覧の側で移す
  const show = (next: ReportSearch) => {
    void navigate({ search: next, resetScroll: false });
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8">
      <AdminPageHeader
        title={REPORTS_PAGE_COPY.title}
        description={REPORTS_PAGE_COPY.description}
      />
      <ReportCaseFilters
        search={search}
        // 選択肢の取得に失敗しても、カテゴリの欄は「すべてのカテゴリ」だけで操作できるようにする
        categories={categories.isError ? NO_CATEGORIES : categories.data}
        onApply={show}
        onReset={() => {
          show({});
        }}
      />
      <ReportCaseTable
        rows={cases.data?.items}
        {...(failure === null
          ? {}
          : {
              error: {
                message: errorMessageOf(
                  failure,
                  ADMIN_PROFILE.contactAvailable,
                ),
                onRetry: () => {
                  void cases.refetch();
                },
              },
            })}
        refetching={refetching}
        pagination={{
          hasPrevious: previous.exists,
          hasNext: nextCursor !== null,
          onPrevious: () => {
            show(reportCaseSearchAt(search, previous.after));
          },
          onNext: () => {
            if (nextCursor === null) {
              return;
            }
            setTrail(trailAfterNext(trail, scope, search.after, nextCursor));
            show(reportCaseSearchAt(search, nextCursor));
          },
        }}
      />
    </div>
  );
}
