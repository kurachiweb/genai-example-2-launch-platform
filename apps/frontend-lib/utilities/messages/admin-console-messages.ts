import { AUDIT_REASON_MAX } from '../../../common-lib/admin/admin-input-rules.ts';

export const ADMIN_PAGINATION_LABEL = 'ページ送り';

export const PREVIOUS_PAGE_LABEL = '前へ';

export const NEXT_PAGE_LABEL = '次へ';

export const ADMIN_FILTER_LABEL = '絞り込み';

export const APPLY_FILTER_LABEL = '適用';

export const RESET_FILTER_LABEL = '解除';

export const REQUIRED_REASON_LABEL = '理由(必須)';

export const OPTIONAL_REASON_LABEL = '理由(任意)';

export const REASON_PERSONAL_INFORMATION_NOTICE =
  '理由には、ユーザーや管理者のメールアドレス・氏名などの個人情報を含めないでください。';

export const REASON_REQUIRED_MESSAGE = '理由を入力してください。';

export const REASON_TOO_LONG_MESSAGE = `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`;

export const AUDITED_ACTION_NOTICE = 'この操作は監査ログに記録されます。';

export const CONFIRM_ACTION_CANCEL_LABEL = 'キャンセル';
