import { useQuery } from '@tanstack/react-query';

import {
  adminUnhandledReportSummaryQueryOptions,
  toUnhandledReportSummary,
} from '../../../graphql/admin-reporting-summaries.ts';
import { DashboardCardFrame } from '../../dashboard/dashboard-card-frame.tsx';
import { dashboardCardStateOf } from '../../dashboard/dashboard-card-state.ts';
import { reportCountLabel } from '../shared/report-messages.ts';
import type { ReportSearchStatus } from '../shared/report-search.ts';
import {
  infringementBreakdownLabel,
  NO_UNHANDLED_REPORTS_MESSAGE,
  UNHANDLED_REPORTS_TITLE,
} from './unhandled-reports-messages.ts';

const UNHANDLED_STATUS: ReportSearchStatus = 'OPEN';

const UNHANDLED_REPORTS_HREF = `/reports?status=${UNHANDLED_STATUS}`;

// 件数は案件の操作の後の無効化で更新するため、定期の取り直しはしない
export function UnhandledReportsCard() {
  const { data, error, isFetching, refetch } = useQuery({
    ...adminUnhandledReportSummaryQueryOptions(),
    select: toUnhandledReportSummary,
  });

  return (
    <DashboardCardFrame
      title={UNHANDLED_REPORTS_TITLE}
      href={UNHANDLED_REPORTS_HREF}
      state={dashboardCardStateOf({
        hasData: data !== undefined,
        error,
        isFetching,
        refetch,
      })}
    >
      {data === undefined || data.open === 0 ? (
        <p className="text-sm text-muted-foreground">
          {NO_UNHANDLED_REPORTS_MESSAGE}
        </p>
      ) : (
        <p className="flex flex-wrap items-baseline gap-x-1">
          <span className="text-4xl font-bold tabular-nums">
            {reportCountLabel(data.open)}
          </span>
          <span className="tabular-nums">
            {infringementBreakdownLabel(data.infringementOpen)}
          </span>
        </p>
      )}
    </DashboardCardFrame>
  );
}
