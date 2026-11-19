import {
  AppError,
  type AppErrorKind,
} from '../../../../lib/core/errors/app-error.ts';
import { API_KEY_ERRORS } from '../../../application/public-api/api-key-errors.ts';
import { PRODUCT_ERRORS } from '../../../application/product/product-errors.ts';

interface PublicApiErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 利用者に見せる文言は文言規則のエラーメッセージと同じにする。ユースケースが投げるコードは同じ定義を使い、経路と上流で文言を揃える
export const PUBLIC_API_ERRORS = Object.freeze({
  unauthenticated: {
    kind: 'unauthenticated',
    message: 'APIキーによる認証が必要です。',
  },
  invalid_api_key: API_KEY_ERRORS.invalid_api_key,
  account_unavailable: API_KEY_ERRORS.account_unavailable,
  insufficient_scope: API_KEY_ERRORS.insufficient_scope,
  product_not_found: PRODUCT_ERRORS.product_not_found,
  user_not_found: {
    kind: 'not_found',
    message: 'ユーザーが見つかりません。',
  },
  launch_not_found: {
    kind: 'not_found',
    message: 'ローンチが見つかりません。',
  },
  match_not_found: {
    kind: 'not_found',
    message: 'マッチが見つかりません。',
  },
  product_hidden: PRODUCT_ERRORS.product_hidden,
} satisfies Readonly<Record<string, PublicApiErrorDefinition>>);

export type PublicApiErrorCode = keyof typeof PUBLIC_API_ERRORS;

export const publicApiError = (code: PublicApiErrorCode): AppError => {
  const { kind, message } = PUBLIC_API_ERRORS[code];
  return new AppError({ kind, code, message });
};
