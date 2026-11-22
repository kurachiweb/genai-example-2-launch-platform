import {
  CATEGORY_NAME_MESSAGES,
  type CategoryNameIssue,
} from '../../../common-lib/admin/admin-input-rules.ts';
import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';

interface ReportingErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 管理画面に見せる文言は文言規則の管理画面のエラーメッセージと同じにする
export const REPORTING_ERRORS = Object.freeze({
  report_category_not_found: {
    kind: 'not_found',
    message: 'カテゴリが見つかりません。',
  },
  report_category_protected: {
    kind: 'unprocessable',
    message: '標準のカテゴリは変更・削除できません。',
  },
  report_category_name_taken: {
    kind: 'conflict',
    message: '同じ名前のカテゴリがあります。',
  },
} satisfies Readonly<Record<string, ReportingErrorDefinition>>);

export type ReportingErrorCode = keyof typeof REPORTING_ERRORS;

// 重複は保存の時点で分かるが、画面が入力欄に理由を示せるよう名前の欄の詳細も付ける
const FIELD_OF_CODE: Partial<
  Readonly<
    Record<
      ReportingErrorCode,
      { readonly field: string; readonly code: string }
    >
  >
> = Object.freeze({
  report_category_name_taken: { field: 'name', code: 'name-taken' },
});

export const reportingError = (code: ReportingErrorCode): AppError => {
  const { kind, message } = REPORTING_ERRORS[code];
  const field = FIELD_OF_CODE[code];
  return new AppError({
    kind,
    code,
    message,
    ...(field === undefined ? {} : { details: [{ ...field, message }] }),
  });
};

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

export const reportCategoryNameRejectedError = (
  issue: CategoryNameIssue,
): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [
      { field: 'name', code: issue, message: CATEGORY_NAME_MESSAGES[issue] },
    ],
  });
