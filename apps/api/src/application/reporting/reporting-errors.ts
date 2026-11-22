import {
  CATEGORY_NAME_MESSAGES,
  type CategoryNameIssue,
} from '../../../common-lib/admin/admin-input-rules.ts';
import {
  INQUIRY_MESSAGE_MAX,
  type InquiryMessageCheck,
  REPORT_ADMIN_REASON_MAX,
  type ReportAdminReasonCheck,
} from '../../../common-lib/reporting/report-case-rules.ts';
import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';

interface ReportingErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 文言は文言規則のエラーメッセージ(利用者側と管理画面)と同じにする
export const REPORTING_ERRORS = Object.freeze({
  report_target_not_found: {
    kind: 'not_found',
    message: '通報の対象が見つかりません。ページを読み込み直してください。',
  },
  report_own_content: {
    kind: 'unprocessable',
    message: '自分のコンテンツは通報できません。',
  },
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
  report_case_not_found: {
    kind: 'not_found',
    message: '通報の案件が見つかりません。',
  },
  report_case_closed: {
    kind: 'unprocessable',
    message:
      'この案件は対応が完了しています。操作するには先に対応ステータスを戻してください。',
  },
  report_case_state_conflict: {
    kind: 'conflict',
    message:
      '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。',
  },
  report_inquiry_not_applicable: {
    kind: 'unprocessable',
    message: 'この案件では照会を送れません。',
  },
  report_inquiry_send_failed: {
    kind: 'unavailable',
    message: '照会を送れませんでした。時間をおいてやり直してください。',
  },
  report_case_open_exists: {
    kind: 'conflict',
    message:
      'この対象には未完了の別の案件があります。その案件で対応してください。',
  },
  report_measure_already_applied: {
    kind: 'unprocessable',
    message: '対象は既に非公開(停止中)です。措置なしで対応済にしてください。',
  },
  report_target_unavailable: {
    kind: 'unprocessable',
    message:
      '対象が見つかりません。措置なしで対応済にするか、却下してください。',
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

const reportFieldError = (
  field: string,
  code: string,
  message: string,
): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [{ field, code, message }],
  });

export const reportCategoryMissingError = (): AppError =>
  reportFieldError('categoryId', 'not-found', 'カテゴリを選んでください。');

export const reportContactEmailRequiredError = (): AppError =>
  reportFieldError(
    'contactEmail',
    'required',
    '連絡先メールアドレスを入力してください。',
  );

const REPORT_ADMIN_REASON_MESSAGES: Readonly<
  Record<Exclude<ReportAdminReasonCheck, 'ok'>, string>
> = Object.freeze({
  required: '理由を入力してください。',
  'too-long': `理由は${String(REPORT_ADMIN_REASON_MAX)}文字以内で入力してください。`,
});

export const reportAdminReasonRejectedError = (
  check: Exclude<ReportAdminReasonCheck, 'ok'>,
): AppError =>
  reportFieldError('reason', check, REPORT_ADMIN_REASON_MESSAGES[check]);

const INQUIRY_MESSAGE_MESSAGES: Readonly<
  Record<Exclude<InquiryMessageCheck, 'ok'>, string>
> = Object.freeze({
  empty: '照会の内容を入力してください。',
  'too-long': `照会の内容は${INQUIRY_MESSAGE_MAX.toLocaleString('en-US')}文字以内で入力してください。`,
});

export const inquiryMessageRejectedError = (
  check: Exclude<InquiryMessageCheck, 'ok'>,
): AppError =>
  reportFieldError('message', check, INQUIRY_MESSAGE_MESSAGES[check]);

// 変更の無い操作を監査ログに残さないよう、現在と同じ状態への変更は変更後の状態の欄の検証のエラーにする
export const reportStatusUnchangedError = (): AppError =>
  reportFieldError(
    'status',
    'unchanged',
    '現在と異なる対応ステータスを選んでください。',
  );
