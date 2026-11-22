import { CATEGORY_NAME_MESSAGES } from '../../../../../common-lib/admin/admin-input-rules.ts';
import { REPORT_LIST_PAGE_SIZE } from '../../../../../common-lib/reporting/report-case-rules.ts';
import {
  REPORT_REASON_MAX,
  type ReportReasonCheck,
} from '../../../../../common-lib/reporting/report-rules.ts';
import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';
import { PRODUCT_ERRORS } from '../../../../application/product/product-errors.ts';
import {
  inquiryMessageRejectedError,
  REPORTING_ERRORS,
  reportAdminReasonRejectedError,
  reportCategoryMissingError,
} from '../../../../application/reporting/reporting-errors.ts';
import { AUTH_INPUT_MESSAGES } from '../../auth-inputs.ts';

// ユースケースが投げるコードと文言はapplication層のreporting-errors.tsにあり、ここでは引数の形式の違反の文言と、リゾルバが検証する連絡先の形式の違反を持つ

const detailMessageOf = (error: AppError): string => {
  const message = error.details?.[0]?.message;
  if (message === undefined) {
    throw new Error(`欄の詳細の無いエラーです: ${error.code}`);
  }
  return message;
};

const REASON_MESSAGES: Readonly<Record<ReportReasonCheck, string | undefined>> =
  Object.freeze({
    ok: undefined,
    empty: '理由を入力してください。',
    'too-long': `理由は${REPORT_REASON_MAX.toLocaleString('en-US')}文字以内で入力してください。`,
  });

// 画面の操作では形式の違うIDや参照を送らないため、存在しない対象と同じ文言を示す。管理者の理由・照会の内容・カテゴリ名の上限の文言は、ユースケースの違反と同じにする
export const REPORTING_INPUT_MESSAGES = Object.freeze({
  pageSize: `表示する件数は1〜${String(REPORT_LIST_PAGE_SIZE)}件の整数で指定してください。`,
  targetRefInvalid: REPORTING_ERRORS.report_target_not_found.message,
  reportCategoryInvalid: detailMessageOf(reportCategoryMissingError()),
  reason: REASON_MESSAGES,
  contactEmailTooLong: AUTH_INPUT_MESSAGES.emailTooLong,
  caseIdInvalid: REPORTING_ERRORS.report_case_not_found.message,
  categoryIdInvalid: REPORTING_ERRORS.report_category_not_found.message,
  productIdInvalid: PRODUCT_ERRORS.product_not_found.message,
  periodReversed: '終了日には開始日と同じか後の日付を入力してください。',
  adminReasonTooLong: detailMessageOf(
    reportAdminReasonRejectedError('too-long'),
  ),
  inquiryMessageTooLong: detailMessageOf(
    inquiryMessageRejectedError('too-long'),
  ),
  categoryNameTooLong: CATEGORY_NAME_MESSAGES['too-long'],
});

// GraphQLの引数の名前。検証の詳細の欄と同じく、ユースケースが返す詳細の欄もこの下の経路で示す
export const INPUT_ARGUMENT = 'input';

export const callerForbiddenError = (): AppError => authError('forbidden');

// 連絡先の要否は通報者の種類で決まるため、引数の検証の後にリゾルバが長さと形式を確かめる。詳細の欄はユースケースと同じく入力からの相対の経路にする
const contactEmailError = (code: string, message: string): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: '入力内容を確認してください。',
    details: [{ field: 'contactEmail', code, message }],
  });

export const reportContactEmailTooLongError = (): AppError =>
  contactEmailError('too-long', REPORTING_INPUT_MESSAGES.contactEmailTooLong);

export const reportContactEmailFormatError = (): AppError =>
  contactEmailError('invalid-format', AUTH_INPUT_MESSAGES.emailFormat);
