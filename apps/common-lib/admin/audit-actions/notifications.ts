import {
  type AuditActionDefinition,
  defineAuditAction,
} from '../audit-action.ts';

export const NOTIFICATION_SENDER_UPDATE_ACTION = defineAuditAction({
  name: 'notification-sender.update',
  label: '通知メールの送信者情報の変更',
  targetKind: 'setting',
  reason: 'optional',
  detailKeys: ['fields'],
  maxTargets: 1,
});

export const NOTIFICATION_AUDIT_ACTIONS: readonly AuditActionDefinition[] =
  Object.freeze([NOTIFICATION_SENDER_UPDATE_ACTION]);
