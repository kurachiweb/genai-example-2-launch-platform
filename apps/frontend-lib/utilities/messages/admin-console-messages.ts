import {
  AUDIT_REASON_MAX,
  CATEGORY_NAME_MAX,
} from '../../../common-lib/admin/admin-input-rules.ts';

export const ADMIN_PAGINATION_LABEL = 'ページ送り';

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

export const CATEGORY_NAME_LABEL = 'カテゴリ名';

export const REQUIRED_CATEGORY_NAME_LABEL = `${CATEGORY_NAME_LABEL}(必須)`;

export const CATEGORY_HANDLE_LABEL = 'ハンドル';

export const CATEGORY_ACTIONS_LABEL = '操作';

export const CATEGORY_HANDLE_UNSET_LABEL = '未設定';

export const CATEGORY_SYSTEM_DEFAULT_LABEL = 'システム標準';

export const CATEGORY_CREATE_LABEL = 'カテゴリを追加';

export const CATEGORY_CREATE_SUBMIT_LABEL = '追加';

export const CATEGORY_UPDATE_SUBMIT_LABEL = '保存';

export const CATEGORY_EDIT_LABEL = '編集';

export const CATEGORY_DELETE_LABEL = '削除';

export const CATEGORY_EMPTY_MESSAGE = 'カテゴリはまだありません。';

export const CATEGORY_SYSTEM_DEFAULT_NOTICE =
  'システム標準のカテゴリは削除できません。';

export const CATEGORY_READ_ONLY_NOTICE =
  'カテゴリを追加・編集・削除する権限がありません。';

export const CATEGORY_NAME_REQUIRED_MESSAGE = 'カテゴリ名を入力してください。';

export const CATEGORY_NAME_TOO_LONG_MESSAGE = `カテゴリ名は${String(CATEGORY_NAME_MAX)}文字以内で入力してください。`;

export const CATEGORY_DELETE_DESCRIPTION = '削除したカテゴリは元に戻せません。';

export const categoryEditTitle = (name: string): string =>
  `カテゴリ「${name}」を編集`;

export const categoryDeleteTitle = (name: string): string =>
  `カテゴリ「${name}」を削除しますか?`;

// 行ごとに並ぶ同じ名前の操作を支援技術で区別するため、見えている操作名の前に読み上げだけのカテゴリ名を置く
export const categoryRowActionTarget = (name: string): string =>
  `「${name}」を`;
