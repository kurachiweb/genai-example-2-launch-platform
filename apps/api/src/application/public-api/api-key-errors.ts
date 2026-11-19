import {
  API_KEY_NAME_MAX_GRAPHEMES,
  type ApiKeyFeature,
  type ApiKeyNameCheck,
} from '../../../common-lib/public-api/api-key-rules.ts';
import {
  AppError,
  type AppErrorKind,
  type FieldErrorDetail,
} from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';

interface ApiKeyErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 利用者に見せる文言は文言規則のエラーメッセージと同じにする
export const API_KEY_ERRORS = Object.freeze({
  account_unavailable: IDENTITY_ERRORS.account_unavailable,
  api_key_not_found: {
    kind: 'not_found',
    message: 'APIキーが見つかりません。',
  },
} satisfies Readonly<Record<string, ApiKeyErrorDefinition>>);

export type ApiKeyErrorCode = keyof typeof API_KEY_ERRORS;

export const apiKeyError = (code: ApiKeyErrorCode): AppError => {
  const { kind, message } = API_KEY_ERRORS[code];
  return new AppError({ kind, code, message });
};

export type ApiKeyNameIssue = Extract<
  ApiKeyNameCheck,
  { readonly ok: false }
>['reason'];

export const API_KEY_NAME_MESSAGES: Readonly<Record<ApiKeyNameIssue, string>> =
  Object.freeze({
    required: '名前を入力してください。',
    too_long: `名前は${String(API_KEY_NAME_MAX_GRAPHEMES)}文字以内で入力してください。`,
  });

export const API_KEY_SCOPE_NOT_ALLOWED_MESSAGE =
  '選べない権限が指定されています。';

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

export const apiKeyNameIssueDetail = (
  issue: ApiKeyNameIssue,
): FieldErrorDetail => ({
  field: 'name',
  code: issue,
  message: API_KEY_NAME_MESSAGES[issue],
});

export const apiKeyScopeIssueDetail = (
  feature: ApiKeyFeature,
): FieldErrorDetail => ({
  field: `scopes.${feature}`,
  code: 'not_allowed',
  message: API_KEY_SCOPE_NOT_ALLOWED_MESSAGE,
});

// GraphQLの引数の検証(withValidatedArgs)と同じ形の詳細にする
export const apiKeyInputRejectedError = (
  details: readonly FieldErrorDetail[],
): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details,
  });
