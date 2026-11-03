import { AppError } from '../../../lib/core/errors/app-error.ts';
import { AUTH_ERRORS, type AuthErrorDefinition } from '../auth/auth-errors.ts';
import {
  createPasswordRejectedError,
  type PasswordRejectedError,
} from '../auth/password-rejection.ts';

export const ADMIN_ERRORS = Object.freeze({
  ...AUTH_ERRORS,
  admin_email_in_use: {
    kind: 'conflict',
    message: 'このメールアドレスは既に管理者として登録されています。',
  },
  last_super_admin: {
    kind: 'conflict',
    message: '最上位管理者が1人だけのため、この操作はできません。',
  },
  self_deletion_forbidden: {
    kind: 'forbidden',
    message: '自分自身のアカウントは削除できません。',
  },
  admin_state_conflict: {
    kind: 'conflict',
    message: '処理が重なりました。時間をおいて再度お試しください。',
  },
} satisfies Readonly<Record<string, AuthErrorDefinition>>);

export type AdminErrorCode = keyof typeof ADMIN_ERRORS;

// 管理者はハンドルを持たないため、利用者の文言からハンドルを除く
export const ADMIN_PASSWORD_MATCHES_IDENTITY_MESSAGE =
  'ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。';

export const adminError = (code: AdminErrorCode): AppError => {
  const { kind, message } = ADMIN_ERRORS[code];
  return new AppError({ kind, code, message });
};

export const adminPasswordRejectedError: PasswordRejectedError =
  createPasswordRejectedError(ADMIN_PASSWORD_MATCHES_IDENTITY_MESSAGE);
