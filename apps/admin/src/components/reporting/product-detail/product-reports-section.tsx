import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';

import { LoadingSkeleton } from '../../../../lib/components/state/loading-skeleton.tsx';
import type { AdminProductDetailContext } from '../../../composition/admin-product-detail-sections.ts';
import {
  adminProductReportSummaryQueryOptions,
  type ProductReportSummaryView,
  toProductReportSummary,
} from '../../../graphql/admin-reporting-summaries.ts';
import { reportCountLabel } from '../shared/report-messages.ts';
import { ReportCaseStatusBadge } from '../shared/report-case-status-badge.tsx';
import {
  NO_PRODUCT_REPORTS_MESSAGE,
  OPEN_REPORT_CASE_LABEL,
  OPEN_REPORT_CASE_LINK_LABEL,
  PRODUCT_REPORTS_TITLE,
} from './product-reports-messages.ts';

export interface ProductReportsSectionProps {
  readonly product: AdminProductDetailContext;
}

interface ProductReportsContentProps {
  readonly summary: ProductReportSummaryView;
}

function ProductReportsContent({
  summary: { reportCount, openCase },
}: ProductReportsContentProps) {
  return (
    <>
      {reportCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          {NO_PRODUCT_REPORTS_MESSAGE}
        </p>
      ) : (
        <p className="text-2xl font-bold tabular-nums">
          {reportCountLabel(reportCount)}
        </p>
      )}
      {openCase === null ? null : (
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{OPEN_REPORT_CASE_LABEL}</dt>
          <dd className="flex flex-wrap items-center gap-3">
            <ReportCaseStatusBadge status={openCase.status} />
            <Link
              to="/reports/$caseId"
              params={{ caseId: openCase.id }}
              className="text-primary underline-offset-2 hover:underline"
            >
              {OPEN_REPORT_CASE_LINK_LABEL}
            </Link>
          </dd>
        </dl>
      )}
    </>
  );
}

// プロダクトの詳細の受け付けた通報の区画。投稿者を読めないプロダクトでも、件数はプロダクトのIDだけで求まる
export function ProductReportsSection({
  product: { productId },
}: ProductReportsSectionProps) {
  const headingId = useId();
  const { data } = useQuery({
    ...adminProductReportSummaryQueryOptions(productId),
    select: toProductReportSummary,
    // 件数が無ければ区画を使えないため、最初の取得の失敗だけを区画のエラーの境界へ渡し、取り直しの失敗では表示中の件数を残す
    throwOnError: (_error, query) => query.state.data === undefined,
  });
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      {/* 再試行の後のフォーカスの移り先にするため、プログラムからだけフォーカスできるようにする */}
      <h2
        id={headingId}
        tabIndex={-1}
        className="rounded-sm text-lg font-extrabold"
      >
        {PRODUCT_REPORTS_TITLE}
      </h2>
      {data === undefined ? (
        <LoadingSkeleton />
      ) : (
        <ProductReportsContent summary={data} />
      )}
    </section>
  );
}
