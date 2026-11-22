import { isClosedStatus } from '../../../../common-lib/reporting/report-case-rules.ts';
import {
  REPORT_CASE_STATUS_LABELS,
  REPORT_RESOLUTION_LABELS,
} from '../../../../common-lib/reporting/report-labels.ts';
import { DateTime } from '../../../../lib/components/datetime/date-time.tsx';
import type { ReportCaseDetailView } from '../../../graphql/admin-reporting-cases.ts';
import { CategoryBreakdown } from '../shared/category-breakdown.tsx';
import { ReportCaseStatusBadge } from '../shared/report-case-status-badge.tsx';
import { reportCountLabel } from '../shared/report-messages.ts';
import { ResponseTimeCell } from '../shared/response-time-cell.tsx';
import { REPORT_CASE_DETAIL_COPY } from './report-case-messages.ts';
import { ReportCaseSection } from './report-case-section.tsx';

export interface ReportCaseStatusSectionProps {
  readonly detail: ReportCaseDetailView;
}

const TERM_CLASS_NAME = 'text-muted-foreground';

const { items } = REPORT_CASE_DETAIL_COPY;

// 却下は措置の種類を持たないため、完了の種類は状態の表示名で示す
const resolutionLabelOf = ({
  case: { status },
  resolution,
}: ReportCaseDetailView): string =>
  status === 'rejected'
    ? REPORT_CASE_STATUS_LABELS.rejected
    : REPORT_RESOLUTION_LABELS[resolution ?? 'none'];

// 対応ステータスと件数と受付日時、権利侵害の案件の対応期間、完了した案件の完了の記録を示す。完了の理由は管理者の入力のため改行を保った文字列で示す
export function ReportCaseStatusSection({
  detail,
}: ReportCaseStatusSectionProps) {
  const { case: reportCase } = detail;
  const closed = isClosedStatus(reportCase.status);

  return (
    <ReportCaseSection title={REPORT_CASE_DETAIL_COPY.sections.status}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className={TERM_CLASS_NAME}>{items.status}</dt>
        <dd>
          <ReportCaseStatusBadge status={reportCase.status} />
        </dd>
        <dt className={TERM_CLASS_NAME}>{items.statusChangedAt}</dt>
        <dd>
          <DateTime value={detail.statusChangedAt} format="longDateTime" />
        </dd>
        <dt className={TERM_CLASS_NAME}>{items.reportCount}</dt>
        <dd>{reportCountLabel(reportCase.reportCount)}</dd>
        <dt className={TERM_CLASS_NAME}>{items.categoryCounts}</dt>
        <dd>
          <CategoryBreakdown counts={reportCase.categoryCounts} />
        </dd>
        <dt className={TERM_CLASS_NAME}>{items.firstReportedAt}</dt>
        <dd>
          <DateTime value={reportCase.firstReportedAt} format="longDateTime" />
        </dd>
        <dt className={TERM_CLASS_NAME}>{items.lastReportedAt}</dt>
        <dd>
          <DateTime value={reportCase.lastReportedAt} format="longDateTime" />
        </dd>
        {reportCase.responseTime === null ? null : (
          <>
            <dt className={TERM_CLASS_NAME}>{items.responseTime}</dt>
            <dd>
              <ResponseTimeCell responseTime={reportCase.responseTime} />
            </dd>
          </>
        )}
        {closed ? (
          <>
            <dt className={TERM_CLASS_NAME}>{items.resolution}</dt>
            <dd>{resolutionLabelOf(detail)}</dd>
            {detail.closingReason === null ? null : (
              <>
                <dt className={TERM_CLASS_NAME}>{items.closingReason}</dt>
                <dd className="break-words whitespace-pre-wrap">
                  {detail.closingReason}
                </dd>
              </>
            )}
            {detail.closedAt === null ? null : (
              <>
                <dt className={TERM_CLASS_NAME}>{items.closedAt}</dt>
                <dd>
                  <DateTime value={detail.closedAt} format="longDateTime" />
                </dd>
              </>
            )}
          </>
        ) : null}
      </dl>
    </ReportCaseSection>
  );
}
