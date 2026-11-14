import { z } from 'zod';

import { checkNickname } from '../../../../../common-lib/identity/account-input-rules.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import type { ReAuthenticationInput } from '../../../../application/identity/re-authenticator.ts';
import {
  currentPassword,
  email,
  inputRuleOf,
  linkToken,
  loginChallenge,
  newPassword,
  secondFactor,
  totpCode,
} from '../../auth-inputs.ts';
import { INPUT_MESSAGES } from './errors.ts';

// セッションのIDは26文字のULIDで、一致しない値はユースケースが見つからないとして扱う。ここでは処理量だけを抑える
const SESSION_ID_INPUT_MAX_LENGTH = 64;

const NICKNAME_MESSAGES = Object.freeze({
  ok: undefined,
  empty: INPUT_MESSAGES.nicknameRequired,
  'too-long': INPUT_MESSAGES.nicknameTooLong,
});

// 判定と保存値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const nickname = inputRuleOf(
  (value) => NICKNAME_MESSAGES[checkNickname(value)],
).transform(trimWhiteSpace);

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
  input: z.object({ challenge: loginChallenge, secondFactor }),
});

export const VERIFY_EMAIL_ARGS = z.object({ token: linkToken });

export const REQUEST_PASSWORD_RESET_ARGS = z.object({ email });

export const RESET_PASSWORD_ARGS = z.object({
  input: z.object({ token: linkToken, newPassword }),
});

// GraphQLで省略可能な第2要素は、省略と明示したnullをどちらも「入力なし」として本人確認へ渡す
const reAuthentication = z
  .object({ currentPassword, secondFactor: secondFactor.nullish() })
  .transform((value): ReAuthenticationInput => ({
    currentPassword: value.currentPassword,
    secondFactor: value.secondFactor ?? undefined,
  }));

export const RE_AUTHENTICATION_ARGS = z.object({ input: reAuthentication });

export const REQUEST_EMAIL_CHANGE_ARGS = z.object({
  input: z.object({ newEmail: email, reAuthentication }),
});

export const REQUEST_PASSWORD_CHANGE_ARGS = z.object({
  input: z.object({ newPassword, reAuthentication }),
});

export const CONFIRM_CHANGE_ARGS = z.object({ token: linkToken });

export const ENABLE_TOTP_ARGS = z.object({ totpCode });

export const REVOKE_SESSION_ARGS = z.object({
  id: z
    .string()
    .max(SESSION_ID_INPUT_MAX_LENGTH, INPUT_MESSAGES.sessionNotFound),
});
