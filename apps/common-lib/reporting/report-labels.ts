import { MODERATION_ACTION_LABELS } from '../moderation/moderation-labels.ts';
import type {
  ReportCaseStatus,
  ReportResolution,
} from './report-case-rules.ts';
import type { ReportTargetKind } from './report-rules.ts';

export const REPORT_TARGET_KIND_LABELS: Readonly<
  Record<ReportTargetKind, string>
> = Object.freeze({
  user: 'ユーザー',
  product: 'プロダクト',
  comment: 'コメント',
});

export const REPORT_CASE_STATUS_LABELS: Readonly<
  Record<ReportCaseStatus, string>
> = Object.freeze({
  open: '未対応',
  in_progress: '対応中',
  resolved: '対応済',
  rejected: '却下',
});

export const REPORT_RESOLUTION_LABELS: Readonly<
  Record<ReportResolution, string>
> = Object.freeze({
  'product.hide': MODERATION_ACTION_LABELS['product.hide'],
  'comment.hide': MODERATION_ACTION_LABELS['comment.hide'],
  'user.suspend': MODERATION_ACTION_LABELS['user.suspend'],
  none: '措置なし',
});

export type ResponseTimeAlert = 'start-overdue' | 'decision-overdue';

export const RESPONSE_TIME_ALERT_LABELS: Readonly<
  Record<ResponseTimeAlert, string>
> = Object.freeze({
  'start-overdue': '確認開始の目標(1営業日)を超えています',
  'decision-overdue': '判断の目標(9日)を超えています',
});
