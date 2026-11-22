import type {
  ReportCaseStatus,
  ReportResolution,
} from '../../../../../common-lib/reporting/report-case-rules.ts';
import type { ResponseTimeAlert } from '../../../../../common-lib/reporting/report-labels.ts';
import type { ReportTargetKind } from '../../../../../common-lib/reporting/report-rules.ts';
import type {
  ReportCaseStatus as GraphQLReportCaseStatus,
  ReportResolution as GraphQLReportResolution,
  ReportTargetKind as GraphQLReportTargetKind,
  ResponseTimeAlert as GraphQLResponseTimeAlert,
} from '../../generated/resolvers-types.ts';

export const REPORT_TARGET_KINDS = Object.freeze({
  USER: 'user',
  PRODUCT: 'product',
  COMMENT: 'comment',
} as const satisfies Record<GraphQLReportTargetKind, ReportTargetKind>);

export const REPORT_CASE_STATUSES = Object.freeze({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  REJECTED: 'rejected',
} as const satisfies Record<GraphQLReportCaseStatus, ReportCaseStatus>);

const GRAPHQL_TARGET_KINDS: Readonly<
  Record<ReportTargetKind, GraphQLReportTargetKind>
> = Object.freeze({ user: 'USER', product: 'PRODUCT', comment: 'COMMENT' });

const GRAPHQL_CASE_STATUSES: Readonly<
  Record<ReportCaseStatus, GraphQLReportCaseStatus>
> = Object.freeze({
  open: 'OPEN',
  in_progress: 'IN_PROGRESS',
  resolved: 'RESOLVED',
  rejected: 'REJECTED',
});

const GRAPHQL_RESOLUTIONS: Readonly<
  Record<ReportResolution, GraphQLReportResolution>
> = Object.freeze({
  'product.hide': 'PRODUCT_HIDE',
  'comment.hide': 'COMMENT_HIDE',
  'user.suspend': 'USER_SUSPEND',
  none: 'NONE',
});

const GRAPHQL_RESPONSE_TIME_ALERTS: Readonly<
  Record<ResponseTimeAlert, GraphQLResponseTimeAlert>
> = Object.freeze({
  'start-overdue': 'START_OVERDUE',
  'decision-overdue': 'DECISION_OVERDUE',
});

export const graphqlReportTargetKindOf = (
  kind: ReportTargetKind,
): GraphQLReportTargetKind => GRAPHQL_TARGET_KINDS[kind];

export const graphqlReportCaseStatusOf = (
  status: ReportCaseStatus,
): GraphQLReportCaseStatus => GRAPHQL_CASE_STATUSES[status];

export const graphqlReportResolutionOf = (
  resolution: ReportResolution,
): GraphQLReportResolution => GRAPHQL_RESOLUTIONS[resolution];

export const graphqlResponseTimeAlertOf = (
  alert: ResponseTimeAlert,
): GraphQLResponseTimeAlert => GRAPHQL_RESPONSE_TIME_ALERTS[alert];
