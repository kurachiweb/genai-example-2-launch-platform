import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { NewPasswordValidation } from '../auth/password-policy.ts';

export type PasswordRejection = Extract<
  NewPasswordValidation,
  { readonly ok: false }
>['violation'];

const PASSWORD_LENGTH_MESSAGE =
  'パスワードは8文字以上128文字以内で入力してください。';

const REJECTION_DETAILS: Readonly<
  Record<PasswordRejection, { readonly code: string; readonly message: string }>
> = Object.freeze({
  pwned: {
    code: 'pwned',
    message:
      'このパスワードは過去に漏洩したことがあります。別のパスワードを設定してください。',
  },
  'matches-identity': {
    code: 'matches_identity',
    message:
      'ハンドル・ニックネーム・メールアドレスと同じパスワードは使えません。',
  },
  'too-short': { code: 'too_short', message: PASSWORD_LENGTH_MESSAGE },
  'too-long': { code: 'too_long', message: PASSWORD_LENGTH_MESSAGE },
});

// 登録・パスワードリセット・パスワード変更で、新しいパスワードが方針に反したときに投げる
export const passwordRejectedError = (
  violation: PasswordRejection,
  field = 'password',
): AppError => {
  const { code, message } = REJECTION_DETAILS[violation];
  return new AppError({
    kind: 'unprocessable',
    code: 'password_rejected',
    message,
    details: [{ field, code, message }],
  });
};
