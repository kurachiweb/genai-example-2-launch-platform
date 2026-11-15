import { z } from 'zod';

import {
  checkPasswordLength,
  countCodePoints,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_CODE_POINTS,
} from '../../../common-lib/identity/account-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import {
  AUTH_ERRORS,
  PASSWORD_LENGTH_MESSAGE,
} from '../../application/auth/auth-errors.ts';
import type { SecondFactorInput } from '../../domain/auth/second-factor.ts';

// 利用者と管理者の認証の操作が共有する入力の検証の失敗(validation_error)の欄ごとの文言
export const AUTH_INPUT_MESSAGES = Object.freeze({
  emailRequired: 'メールアドレスを入力してください。',
  emailTooLong: `メールアドレスは${String(EMAIL_MAX_LENGTH)}文字以内で入力してください。`,
  emailFormat: 'メールアドレスの形式が正しくありません。',
  passwordRequired: 'パスワードを入力してください。',
  passwordLength: PASSWORD_LENGTH_MESSAGE,
  secondFactorChoice:
    '認証コードかリカバリコードのどちらか一方を入力してください。',
  secondFactorIncorrect: AUTH_ERRORS.invalid_second_factor.message,
  invalidLink: AUTH_ERRORS.invalid_link.message,
  loginChallengeExpired: AUTH_ERRORS.login_challenge_expired.message,
});

// メールのリンクと第2要素の待ちの値は43文字のbase64urlで、照合できない値はユースケースが無効として扱う。ここでは処理量だけを抑える
const TOKEN_INPUT_MAX_LENGTH = 256;

// 認証コードとリカバリコードの正規化の前の上限(ドメインの上限より長い入力は照合されない)
const SECOND_FACTOR_INPUT_MAX_LENGTH = 64;

// 1つの欄には最初の1つの違反だけを示す
export const inputRuleOf = (check: (value: string) => string | undefined) =>
  z.string().superRefine((value, context) => {
    const message = check(value);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

const checkEmail = (value: string): string | undefined => {
  const trimmed = trimWhiteSpace(value);
  if (trimmed === '') {
    return AUTH_INPUT_MESSAGES.emailRequired;
  }
  if (trimmed.length > EMAIL_MAX_LENGTH) {
    return AUTH_INPUT_MESSAGES.emailTooLong;
  }
  return z.regexes.html5Email.test(trimmed)
    ? undefined
    : AUTH_INPUT_MESSAGES.emailFormat;
};

export const email = inputRuleOf(checkEmail).transform(trimWhiteSpace);

export const newPassword = inputRuleOf((value) =>
  checkPasswordLength(value) === 'ok'
    ? undefined
    : AUTH_INPUT_MESSAGES.passwordLength,
);

// 登録済みのパスワードの照合では下限を問わず、照合の計算量だけを上限で抑える
export const currentPassword = inputRuleOf((value) => {
  if (value === '') {
    return AUTH_INPUT_MESSAGES.passwordRequired;
  }
  return countCodePoints(value) > PASSWORD_MAX_CODE_POINTS
    ? AUTH_INPUT_MESSAGES.passwordLength
    : undefined;
});

// 無効なリンクの文言は主体ごとに異なり得るため、超過の文言を受け取る
export const linkTokenOf = (message: string) =>
  z.string().max(TOKEN_INPUT_MAX_LENGTH, message);

export const linkToken = linkTokenOf(AUTH_INPUT_MESSAGES.invalidLink);

export const loginChallenge = z
  .string()
  .max(TOKEN_INPUT_MAX_LENGTH, AUTH_INPUT_MESSAGES.loginChallengeExpired);

export const totpCode = z
  .string()
  .max(
    SECOND_FACTOR_INPUT_MAX_LENGTH,
    AUTH_INPUT_MESSAGES.secondFactorIncorrect,
  );

const secondFactorCode = totpCode
  .nullish()
  .transform((value) => (value === '' || value === null ? undefined : value));

// GraphQLでは両方を省略可能な入力にし、どちらか一方だけが入力されたことをここで確かめる
export const secondFactor = z
  .object({ totpCode: secondFactorCode, recoveryCode: secondFactorCode })
  .transform((value, context): SecondFactorInput => {
    if (value.totpCode !== undefined && value.recoveryCode === undefined) {
      return { kind: 'totp', code: value.totpCode };
    }
    if (value.recoveryCode !== undefined && value.totpCode === undefined) {
      return { kind: 'recovery', code: value.recoveryCode };
    }
    context.addIssue({
      code: 'custom',
      message: AUTH_INPUT_MESSAGES.secondFactorChoice,
    });
    return z.NEVER;
  });
