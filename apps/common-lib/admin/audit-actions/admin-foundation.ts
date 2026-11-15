import {
  type AuditActionDefinition,
  defineAuditAction,
} from '../audit-action.ts';

export const ADMIN_ACCOUNT_INVITE_ACTION = defineAuditAction({
  name: 'admin-account.invite',
  label: '管理者の招待',
  targetKind: 'admin',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const ADMIN_ACCOUNT_DELETE_ACTION = defineAuditAction({
  name: 'admin-account.delete',
  label: '管理者の削除',
  targetKind: 'admin',
  reason: 'optional',
  detailKeys: [],
  maxTargets: 1,
});

export const ADMIN_ACCOUNT_ROLE_CHANGE_ACTION = defineAuditAction({
  name: 'admin-account.role-change',
  label: '管理者のロールの変更',
  targetKind: 'admin',
  reason: 'optional',
  detailKeys: ['fromRole', 'toRole'],
  maxTargets: 1,
});

// 検索文字列を記録に残さないため、理由と詳細を受け付けず、対象は検索結果に表示した利用者の仮名化IDだけにする
export const USER_EMAIL_SEARCH_ACTION = defineAuditAction({
  name: 'user.email-search',
  label: 'ユーザーのメールアドレス検索',
  targetKind: 'user',
  reason: 'none',
  detailKeys: [],
  maxTargets: 100,
});

export const ADMIN_FOUNDATION_AUDIT_ACTIONS: readonly AuditActionDefinition[] =
  Object.freeze([
    ADMIN_ACCOUNT_INVITE_ACTION,
    ADMIN_ACCOUNT_DELETE_ACTION,
    ADMIN_ACCOUNT_ROLE_CHANGE_ACTION,
    USER_EMAIL_SEARCH_ACTION,
  ]);
