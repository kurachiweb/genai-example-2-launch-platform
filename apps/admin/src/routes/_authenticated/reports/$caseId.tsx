import { createFileRoute } from '@tanstack/react-router';

import { ReportCaseNotFoundPage } from '../../../components/pages/report-case-not-found-page.tsx';
import { ReportCasePage } from '../../../components/pages/report-case-page.tsx';
import { REPORT_CASE_PAGE_TITLE } from '../../../components/reporting/shared/report-messages.ts';
import { loadReportCasePage } from '../../../graphql/admin-reporting-cases.ts';
import { buildAdminPageHead } from '../../../head/page-heads.ts';

export const Route = createFileRoute('/_authenticated/reports/$caseId')({
  loader: loadReportCasePage,
  head: () => buildAdminPageHead({ title: REPORT_CASE_PAGE_TITLE }),
  component: ReportCasePage,
  // 見つからない案件はサイト全体の存在しないページではなく、一覧へ戻る導線を持つ案件の不在の表示にする
  notFoundComponent: () => <ReportCaseNotFoundPage />,
});
