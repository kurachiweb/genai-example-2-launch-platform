import { CircleAlertIcon } from 'lucide-react';

import { RESPONSE_TIME_ALERT_LABELS } from '../../../../common-lib/reporting/report-labels.ts';
import type { ReportResponseTimeView } from '../../../graphql/admin-reporting-cases.ts';
import {
  formatReportElapsed,
  responseTimePrefixOf,
  UNKNOWN_RESPONSE_TIME_LABEL,
} from './report-messages.ts';

export interface ResponseTimeCellProps {
  // nullは権利侵害の案件でない
  readonly responseTime: ReportResponseTimeView | null;
}

// 権利侵害の案件の対応期間を示し、目標の超過は色だけに頼らず文言でも強調する
export function ResponseTimeCell({ responseTime }: ResponseTimeCellProps) {
  if (responseTime === null) {
    return null;
  }
  const { completedAt, elapsedSeconds, alerts } = responseTime;
  return (
    <div className="flex flex-col gap-1">
      {elapsedSeconds === null ? (
        <span>{UNKNOWN_RESPONSE_TIME_LABEL}</span>
      ) : (
        <span>
          {responseTimePrefixOf(completedAt)}{' '}
          <time dateTime={`PT${String(elapsedSeconds)}S`}>
            {formatReportElapsed(elapsedSeconds)}
          </time>
        </span>
      )}
      {alerts.map((alert) => (
        <span
          key={alert}
          className="flex items-start gap-1 text-sm font-semibold text-destructive"
        >
          <CircleAlertIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          {RESPONSE_TIME_ALERT_LABELS[alert]}
        </span>
      ))}
    </div>
  );
}
