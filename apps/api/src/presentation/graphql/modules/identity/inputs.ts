import { z } from 'zod';

import {
  checkNickname,
  checkPasswordLength,
  countCodePoints,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_CODE_POINTS,
} from '../../../../../common-lib/identity/account-input-rules.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import type { SecondFactorInput } from '../../../../domain/auth/second-factor.ts';
import { INPUT_MESSAGES } from './errors.ts';

// メールのリンクと第2要素の待ちの値は43文字のbase64urlで、照合できない値はユースケースが無効として扱う。ここでは処理量だけを抑える
const TOKEN_INPUT_MAX_LENGTH = 256;

// 認証コードとリカバリコードの正規化の前の上限(ドメインの上限より長い入力は照合されない)
const SECOND_FACTOR_INPUT_MAX_LENGTH = 64;

// 1つの欄には最初の1つの違反だけを示す
const ruleOf = (check: (value: string) => string | undefined) =>
  z.string().superRefine((value, context) => {
    const message = check(value);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

const NICKNAME_MESSAGES = Object.freeze({
  ok: undefined,
  empty: INPUT_MESSAGES.nicknameRequired,
  'too-long': INPUT_MESSAGES.nicknameTooLong,
});

// 判定と保存値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const nickname = ruleOf(
  (value) => NICKNAME_MESSAGES[checkNickname(value)],
).transform(trimWhiteSpace);

const checkEmail = (value: string): string | undefined => {
  const trimmed = trimWhiteSpace(value);
  if (trimmed === '') {
    return INPUT_MESSAGES.emailRequired;
  }
  if (trimmed.length > EMAIL_MAX_LENGTH) {
    return INPUT_MESSAGES.emailTooLong;
  }
  return z.regexes.html5Email.test(trimmed)
    ? undefined
    : INPUT_MESSAGES.emailFormat;
};

export const email = ruleOf(checkEmail).transform(trimWhiteSpace);

export const newPassword = ruleOf((value) =>
  checkPasswordLength(value) === 'ok'
    ? undefined
    : INPUT_MESSAGES.passwordLength,
);

// 登録済みのパスワードの照合では下限を問わず、照合の計算量だけを上限で抑える
export const currentPassword = ruleOf((value) => {
  if (value === '') {
    return INPUT_MESSAGES.passwordRequired;
  }
  return countCodePoints(value) > PASSWORD_MAX_CODE_POINTS
    ? INPUT_MESSAGES.passwordLength
    : undefined;
});

export const linkToken = z
  .string()
  .max(TOKEN_INPUT_MAX_LENGTH, INPUT_MESSAGES.invalidLink);

const secondFactorCode = z
  .string()
  .max(SECOND_FACTOR_INPUT_MAX_LENGTH, INPUT_MESSAGES.secondFactorIncorrect)
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
      message: INPUT_MESSAGES.secondFactorChoice,
    });
    return z.NEVER;
  });

export const REGISTER_USER_ARGS = z.object({
  input: z.object({
    nickname,
    email,
    password: newPassword,
    agreedToTerms: z.literal(true, { error: INPUT_MESSAGES.termsNotAgreed }),
  }),
});

export const LOGIN_ARGS = z.object({
  input: z.object({ email, password: currentPassword }),
});

export const COMPLETE_SECOND_FACTOR_LOGIN_ARGS = z.object({
  input: z.object({
    challenge: z
      .string()
      .max(TOKEN_INPUT_MAX_LENGTH, INPUT_MESSAGES.loginChallengeExpired),
    secondFactor,
  }),
});

export const VERIFY_EMAIL_ARGS = z.object({ token: linkToken });

export const REQUEST_PASSWORD_RESET_ARGS = z.object({ email });

export const RESET_PASSWORD_ARGS = z.object({
  input: z.object({ token: linkToken, newPassword }),
});
