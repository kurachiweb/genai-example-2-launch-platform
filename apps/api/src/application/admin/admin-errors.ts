import { ADMIN_NICKNAME_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
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

const INVITATION_RESEND_REQUEST_MESSAGE =
  '招待した管理者に再送を依頼してください。';

// 招待された運営者は自分でリンクを取り直せないため、無効なリンクの文言に再送の依頼の案内を添える
export const adminInvitationLinkError = (): AppError => {
  const { kind, message } = ADMIN_ERRORS.invalid_link;
  return new AppError({
    kind,
    code: 'invalid_link',
    message: `${message}${INVITATION_RESEND_REQUEST_MESSAGE}`,
  });
};

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

export type AdminNicknameViolation = 'empty' | 'too-long';

export const ADMIN_NICKNAME_MESSAGES: Readonly<
  Record<AdminNicknameViolation, string>
> = Object.freeze({
  empty: 'ニックネームを入力してください。',
  'too-long': `ニックネームは${String(ADMIN_NICKNAME_MAX)}文字以内で入力してください。`,
});

export const adminNicknameRejectedError = (
  violation: AdminNicknameViolation,
): AppError => {
  const message = ADMIN_NICKNAME_MESSAGES[violation];
  return new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [{ field: 'nickname', code: violation, message }],
  });
};
