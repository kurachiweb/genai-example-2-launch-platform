import { invalidCursorError } from '../../../../../lib/core/errors/invalid-cursor.ts';
import type { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { PAYMENTS_ERRORS } from '../../../../application/payments/payments-errors.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';

// 決済のエラーコードと文言・決済セッションのIDと件数の違反の文言はapplication層のpayments-errors.tsとcommon-libのpayment-input-rules.tsにある

// 購入のIDは26文字のULIDで、一致しない値はユースケースが見つからない旨にする。長すぎる値も同じ文言で入力の誤りにする
export const PURCHASE_ID_TOO_LONG_MESSAGE =
  PAYMENTS_ERRORS.checkout_not_found.message;

export const CURSOR_TOO_LONG_MESSAGE = invalidCursorError().message;

export const callerForbiddenError = (): AppError => authError('forbidden');
