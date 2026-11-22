import { AUDIT_REASON_MAX } from '../admin/admin-input-rules.ts';
import { countGraphemes } from '../text/graphemes.ts';
import { trimWhiteSpace } from '../text/white-space.ts';
import type { ReportTargetKind } from './report-rules.ts';

export const REPORT_CASE_STATUSES = Object.freeze([
  'open',
  'in_progress',
  'resolved',
  'rejected',
] as const);

export type ReportCaseStatus = (typeof REPORT_CASE_STATUSES)[number];

export type OpenReportCaseStatus = 'open' | 'in_progress';

export const isClosedStatus = (status: ReportCaseStatus): boolean =>
  status === 'resolved' || status === 'rejected';

export const canChangeStatusManually = (
  from: ReportCaseStatus,
  to: ReportCaseStatus,
): boolean => from !== to;

export type ManualStatusChangeKind = 'progress' | 'close' | 'reopen';

// 完了どうしの変更も完了の記録を書き直すため、変更後が完了ならcloseとする
export const manualStatusChangeKind = (
  from: ReportCaseStatus,
  to: ReportCaseStatus,
): ManualStatusChangeKind => {
  if (isClosedStatus(to)) {
    return 'close';
  }
  return isClosedStatus(from) ? 'reopen' : 'progress';
};

export const REPORT_RESOLUTIONS = Object.freeze([
  'product.hide',
  'comment.hide',
  'user.suspend',
  'none',
] as const);

export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];

export type ReportMeasure = Exclude<ReportResolution, 'none'>;

const MEASURES: Readonly<Record<ReportTargetKind, ReportMeasure>> =
  Object.freeze({
    product: 'product.hide',
    comment: 'comment.hide',
    user: 'user.suspend',
  });

export const measureFor = (kind: ReportTargetKind): ReportMeasure =>
  MEASURES[kind];

export const INQUIRY_MESSAGE_MAX = 1000;

export const INQUIRY_RESPONSE_DAYS = 7;

export const REPORT_LIST_PAGE_SIZE = 50;

export const REPORT_LIST_EXCERPT_MAX = 200;

export const REPORT_NOTICE_EXCERPT_MAX = 100;

export type InquiryMessageCheck = 'ok' | 'empty' | 'too-long';

export const checkInquiryMessage = (value: string): InquiryMessageCheck => {
  const graphemes = countGraphemes(trimWhiteSpace(value));
  if (graphemes === 0) {
    return 'empty';
  }
  return graphemes > INQUIRY_MESSAGE_MAX ? 'too-long' : 'ok';
};

export type ReportAdminAction =
  | 'status-progress'
  | 'status-close'
  | 'status-reopen'
  | 'resolve'
  | 'reject'
  | 'inquire';

// 管理者の理由は監査ログの理由としても記録するため、監査ログの理由の上限を超えられない
export const REPORT_ADMIN_REASON_MAX = AUDIT_REASON_MAX;

const REQUIRED_REASON_ACTIONS: ReadonlySet<ReportAdminAction> = new Set([
  'status-close',
  'status-reopen',
  'resolve',
  'reject',
]);

export type ReportAdminReasonCheck = 'ok' | 'required' | 'too-long';

export const checkReportAdminReason = (
  action: ReportAdminAction,
  reason: string | undefined,
): ReportAdminReasonCheck => {
  const graphemes = countGraphemes(trimWhiteSpace(reason ?? ''));
  if (graphemes === 0 && REQUIRED_REASON_ACTIONS.has(action)) {
    return 'required';
  }
  return graphemes > REPORT_ADMIN_REASON_MAX ? 'too-long' : 'ok';
};
