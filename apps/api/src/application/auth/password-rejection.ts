import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  PASSWORD_LENGTH_MESSAGE,
  PWNED_PASSWORD_MESSAGE,
} from './auth-errors.ts';
import type { NewPasswordValidation } from './password-policy.ts';

export type PasswordRejection = Extract<
  NewPasswordValidation,
  { readonly ok: false }
>['violation'];

export type PasswordRejectedError = (
  violation: PasswordRejection,
  field?: string,
) => AppError;

// 識別子の種類が主体で異なるため、識別子との一致の文言だけを主体ごとに受け取る
export const createPasswordRejectedError = (
  matchesIdentityMessage: string,
): PasswordRejectedError => {
  const details: Readonly<
    Record<
      PasswordRejection,
      { readonly code: string; readonly message: string }
    >
  > = Object.freeze({
    pwned: { code: 'pwned', message: PWNED_PASSWORD_MESSAGE },
    'matches-identity': {
      code: 'matches_identity',
      message: matchesIdentityMessage,
    },
    'too-short': { code: 'too_short', message: PASSWORD_LENGTH_MESSAGE },
    'too-long': { code: 'too_long', message: PASSWORD_LENGTH_MESSAGE },
  });
  return (violation, field = 'password') => {
    const { code, message } = details[violation];
    return new AppError({
      kind: 'unprocessable',
      code: 'password_rejected',
      message,
      details: [{ field, code, message }],
    });
  };
};
