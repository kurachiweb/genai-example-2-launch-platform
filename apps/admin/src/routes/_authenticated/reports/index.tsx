import { createFileRoute } from '@tanstack/react-router';

import { ReportsPage } from '../../../components/pages/reports-page.tsx';
import { loadReportsPage } from '../../../components/reporting/shared/load-reports-page.ts';
import { REPORTS_PAGE_COPY } from '../../../components/reporting/shared/report-messages.ts';
import { toReportSearch } from '../../../components/reporting/shared/report-search.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

// 受付日の期間を受付日時の範囲にする地域は描画する場所で決まるため、loaderの依存には検索パラメータをそのまま渡す
export const Route = createFileRoute('/_authenticated/reports/')({
  validateSearch: toReportSearch,
  loaderDeps: ({ search }) => search,
  loader: loadReportsPage,
  head: () => buildAdminPageHead({ title: REPORTS_PAGE_COPY.title }),
  component: ReportsPage,
});
