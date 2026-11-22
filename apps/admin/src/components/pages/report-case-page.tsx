import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ArrowLeftIcon } from 'lucide-react';
import { useRef } from 'react';

import { AdminPageHeader } from '../../../lib/components/admin/admin-page-header.tsx';
import {
  adminReportCaseQueryOptions,
  toReportCaseDetail,
} from '../../graphql/admin-reporting-cases.ts';
import { REPORT_CASE_DETAIL_COPY } from '../reporting/case/report-case-messages.ts';
import { ReportCaseOperationsSection } from '../reporting/case/report-case-operations-section.tsx';
import { ReportCaseStatusSection } from '../reporting/case/report-case-status-section.tsx';
import { ReportCaseTargetSection } from '../reporting/case/report-case-target-section.tsx';
import { ReportInquiryPanel } from '../reporting/case/report-inquiry-panel.tsx';
import { ReportList } from '../reporting/case/report-list.tsx';
import { ReportCaseDialogHost } from '../reporting/shared/report-case-dialog-host.tsx';
import { REPORT_CASE_PAGE_TITLE } from '../reporting/shared/report-messages.ts';
import { ReportCaseNotFoundPage } from './report-case-not-found-page.tsx';

const routeApi = getRouteApi('/_authenticated/reports/$caseId');

export function ReportCasePage() {
  const { caseId } = routeApi.useParams();
  const { data: detail } = useSuspenseQuery({
    ...adminReportCaseQueryOptions(caseId),
    select: toReportCaseDetail,
  });
  const operationsHeadingRef = useRef<HTMLHeadingElement>(null);
  // loaderが確かめた案件が取り直しで消えるのは、読んだ後の物理削除と、操作の確定の時点で見つからなかった後。操作ごと詳細が外れるため、見つからない表示へフォーカスを移す
  if (detail === null) {
    return <ReportCaseNotFoundPage replacedDetail />;
  }
  const { case: reportCase } = detail;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <div className="flex flex-col gap-3">
        <AdminPageHeader title={REPORT_CASE_PAGE_TITLE} />
        <Link
          to="/reports"
          className="inline-flex items-center gap-1 self-start text-sm text-primary underline-offset-2 hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          {REPORT_CASE_DETAIL_COPY.backToList}
        </Link>
      </div>
      {/* 取り直しで案件が完了・不在になると確認の前提や画面ごとが替わるため、失敗の後の取り直しを確認のダイアログを閉じるまで遅らせる */}
      <ReportCaseDialogHost
        fallbackFocusRef={operationsHeadingRef}
        deferRefresh
      >
        <div className="flex flex-col gap-6">
          <ReportCaseTargetSection target={reportCase.target} />
          <ReportCaseStatusSection detail={detail} />
          {reportCase.infringement ? (
            <ReportInquiryPanel detail={detail} />
          ) : null}
          <ReportCaseOperationsSection
            reportCase={reportCase}
            headingRef={operationsHeadingRef}
          />
          <ReportList reports={detail.reports} />
        </div>
      </ReportCaseDialogHost>
    </div>
  );
}
