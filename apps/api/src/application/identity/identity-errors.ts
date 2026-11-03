import { AppError } from '../../../lib/core/errors/app-error.ts';
import { AUTH_ERRORS, type AuthErrorDefinition } from '../auth/auth-errors.ts';

// 利用者に見せる文言は文言規則のエラーメッセージと同じにする
export const IDENTITY_ERRORS = Object.freeze({
  ...AUTH_ERRORS,
  registration_email_unavailable: {
    kind: 'conflict',
    message: 'このメールアドレスは登録できません。',
  },
  account_unavailable: {
    kind: 'forbidden',
    message:
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
  },
  email_not_verified: {
    kind: 'forbidden',
    message:
      'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
  },
  totp_already_enabled: {
    kind: 'conflict',
    message: '多要素認証は既に有効です。',
  },
  totp_not_enabled: {
    kind: 'conflict',
    message: '多要素認証は有効になっていません。',
  },
  account_state_conflict: {
    kind: 'conflict',
    message: '処理が重なりました。時間をおいて再度お試しください。',
  },
} satisfies Readonly<Record<string, AuthErrorDefinition>>);

export type IdentityErrorCode = keyof typeof IDENTITY_ERRORS;

export const PASSWORD_MATCHES_IDENTITY_MESSAGE =
  'ハンドル・ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。';

export const identityError = (code: IdentityErrorCode): AppError => {
  const { kind, message } = IDENTITY_ERRORS[code];
  return new AppError({ kind, code, message });
};
