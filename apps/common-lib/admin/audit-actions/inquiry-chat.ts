import {
  type AuditActionDefinition,
  defineAuditAction,
} from '../audit-action.ts';

export const INQUIRY_REPLY_ACTION = defineAuditAction({
  name: 'inquiry.reply',
  label: '問い合わせへの返信',
  targetKind: 'inquiry',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const INQUIRY_STATUS_CHANGE_ACTION = defineAuditAction({
  name: 'inquiry.status-change',
  label: '対応ステータスの変更',
  targetKind: 'inquiry',
  reason: 'optional',
  detailKeys: ['kind', 'fromStatus', 'toStatus'],
  maxTargets: 1,
});

export const INQUIRY_CATEGORY_CREATE_ACTION = defineAuditAction({
  name: 'inquiry-category.create',
  label: '問い合わせカテゴリの追加',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const INQUIRY_CATEGORY_RENAME_ACTION = defineAuditAction({
  name: 'inquiry-category.rename',
  label: '問い合わせカテゴリの名前の変更',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const INQUIRY_CATEGORY_DELETE_ACTION = defineAuditAction({
  name: 'inquiry-category.delete',
  label: '問い合わせカテゴリの削除',
  targetKind: 'category',
  reason: 'optional',
  detailKeys: ['reassignedCount'],
  maxTargets: 1,
});

export const INQUIRY_AUDIT_ACTIONS: readonly AuditActionDefinition[] =
  Object.freeze([
    INQUIRY_REPLY_ACTION,
    INQUIRY_STATUS_CHANGE_ACTION,
    INQUIRY_CATEGORY_CREATE_ACTION,
    INQUIRY_CATEGORY_RENAME_ACTION,
    INQUIRY_CATEGORY_DELETE_ACTION,
  ]);
