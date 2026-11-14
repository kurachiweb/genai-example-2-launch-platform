import type { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';
import { NOTIFICATIONS_ERRORS } from '../../../../application/notifications/notifications-errors.ts';

// 入力の検証の失敗(validation_error)の欄ごとの文言。ユースケースが投げるエラーの文言はapplication層のnotifications-errors.tsにある
export const INPUT_MESSAGES = Object.freeze({
  // 長さの違反するトークンも照合できないトークンと同じく無効なリンクとして示す
  unsubscribeTokenInvalid: NOTIFICATIONS_ERRORS.invalid_link.message,
});

export const callerForbiddenError = (): AppError => authError('forbidden');
