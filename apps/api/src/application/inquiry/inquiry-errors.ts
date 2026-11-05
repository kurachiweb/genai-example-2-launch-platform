import { CATEGORY_NAME_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
import { INQUIRY_CATEGORY_OTHER_NAME } from '../../../common-lib/inquiry/inquiry-category-constants.ts';
import type { InquiryTextIssue } from '../../../common-lib/inquiry/inquiry-input-rules.ts';
import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';

interface InquiryErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

export const INQUIRY_ERRORS = Object.freeze({
  member_inquiry_required: {
    kind: 'forbidden',
    message:
      'ログイン中のため、このフォームは使えません。ページを再読み込みしてください。',
  },
  inquiry_not_found: {
    kind: 'not_found',
    message: '問い合わせが見つかりません。',
  },
  inquiry_read_only: {
    kind: 'conflict',
    message: '退会したユーザーの問い合わせのため、操作できません。',
  },
  inquiry_not_repliable: {
    kind: 'conflict',
    message: 'ログインしていないユーザーの問い合わせには返信できません。',
  },
  inquiry_state_conflict: {
    kind: 'conflict',
    message: '処理が重なりました。画面を更新して再度お試しください。',
  },
  inquiry_category_name_taken: {
    kind: 'conflict',
    message: '同じ名前のカテゴリが既にあります。',
  },
  inquiry_category_protected: {
    kind: 'conflict',
    message: `標準カテゴリ「${INQUIRY_CATEGORY_OTHER_NAME}」は変更・削除できません。`,
  },
  inquiry_category_not_found: {
    kind: 'not_found',
    message: 'カテゴリが見つかりません。',
  },
} satisfies Readonly<Record<string, InquiryErrorDefinition>>);

export type InquiryErrorCode = keyof typeof INQUIRY_ERRORS;

export const inquiryError = (code: InquiryErrorCode): AppError => {
  const { kind, message } = INQUIRY_ERRORS[code];
  return new AppError({ kind, code, message });
};

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

const CATEGORY_NAME_FIELD = 'name';

const CATEGORY_NAME_MESSAGES: Readonly<Record<InquiryTextIssue, string>> =
  Object.freeze({
    'forbidden-character': 'カテゴリ名に使用できない文字が含まれています。',
    empty: 'カテゴリ名を入力してください。',
    'too-long': `カテゴリ名は${String(CATEGORY_NAME_MAX)}文字以内で入力してください。`,
  });

export const inquiryCategoryNameRejectedError = (
  issue: InquiryTextIssue,
): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [
      {
        field: CATEGORY_NAME_FIELD,
        code: issue,
        message: CATEGORY_NAME_MESSAGES[issue],
      },
    ],
  });

// 重複は保存の時点で分かるが、画面が入力欄に理由を示せるよう名前の欄の詳細も付ける
export const inquiryCategoryNameTakenError = (): AppError => {
  const { kind, message } = INQUIRY_ERRORS.inquiry_category_name_taken;
  return new AppError({
    kind,
    code: 'inquiry_category_name_taken',
    message,
    details: [{ field: CATEGORY_NAME_FIELD, code: 'name-taken', message }],
  });
};
