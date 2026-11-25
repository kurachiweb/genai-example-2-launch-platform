import {
  type AuditActionDefinition,
  defineAuditAction,
} from '../audit-action.ts';

export const REPORT_STATUS_CHANGE_ACTION = defineAuditAction({
  name: 'report.status-change',
  label: '通報の対応ステータスの変更',
  targetKind: 'report',
  reason: 'optional',
  detailKeys: ['fromStatus', 'toStatus'],
  maxTargets: 1,
});

export const REPORT_RESOLVE_ACTION = defineAuditAction({
  name: 'report.resolve',
  label: '通報への対応(対応済)',
  targetKind: 'report',
  reason: 'required',
  detailKeys: ['resolution', 'mode', 'fromStatus'],
  maxTargets: 1,
});

export const REPORT_REJECT_ACTION = defineAuditAction({
  name: 'report.reject',
  label: '通報の却下',
  targetKind: 'report',
  reason: 'required',
  detailKeys: ['mode', 'fromStatus'],
  maxTargets: 1,
});

export const REPORT_INQUIRE_ACTION = defineAuditAction({
  name: 'report.inquire',
  label: '権利侵害の照会',
  targetKind: 'report',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const REPORT_CATEGORY_CREATE_ACTION = defineAuditAction({
  name: 'report-category.create',
  label: '通報カテゴリの追加',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const REPORT_CATEGORY_RENAME_ACTION = defineAuditAction({
  name: 'report-category.rename',
  label: '通報カテゴリの名前の変更',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const REPORT_CATEGORY_DELETE_ACTION = defineAuditAction({
  name: 'report-category.delete',
  label: '通報カテゴリの削除',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: ['reassignedCount'],
  maxTargets: 1,
});

export const REPORTING_AUDIT_ACTIONS: readonly AuditActionDefinition[] =
  Object.freeze([
    REPORT_STATUS_CHANGE_ACTION,
    REPORT_RESOLVE_ACTION,
    REPORT_REJECT_ACTION,
    REPORT_INQUIRE_ACTION,
    REPORT_CATEGORY_CREATE_ACTION,
    REPORT_CATEGORY_RENAME_ACTION,
    REPORT_CATEGORY_DELETE_ACTION,
  ]);
