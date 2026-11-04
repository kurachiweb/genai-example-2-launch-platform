import {
  checkPasswordLength,
  countCodePoints,
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
} from '../../../common-lib/identity/account-input-rules.ts';
import {
  ADMIN_NICKNAME_MAX,
  checkAdminNickname,
} from '../../../common-lib/admin/admin-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';

// APIサーバーの入力の検証と同じ文言にする(文言規則のエラーメッセージ)
export const AUTH_FORM_MESSAGES = Object.freeze({
  emailRequired: 'メールアドレスを入力してください。',
  emailTooLong: `メールアドレスは${String(EMAIL_MAX_LENGTH)}文字以内で入力してください。`,
  emailFormat: 'メールアドレスの形式が正しくありません。',
  passwordRequired: 'パスワードを入力してください。',
  passwordLength: `パスワードは${String(PASSWORD_MIN_CODE_POINTS)}文字以上${String(PASSWORD_MAX_CODE_POINTS)}文字以内で入力してください。`,
  totpCodeRequired: '認証コードを入力してください。',
  recoveryCodeRequired: 'リカバリコードを入力してください。',
  secondFactorIncorrect: '認証コードが正しくありません。',
  nicknameRequired: 'ニックネームを入力してください。',
  nicknameTooLong: `ニックネームは${String(ADMIN_NICKNAME_MAX)}文字以内で入力してください。`,
});

// APIサーバーが認証コードとリカバリコードの正規化の前に受け付ける上限
const SECOND_FACTOR_INPUT_MAX_LENGTH = 64;

// 1つの欄には最初の1つの違反だけを示す
const ruleOf = (check: (value: string) => string | undefined) =>
  z.string().superRefine((value, context) => {
    const message = check(value);
    if (message !== undefined) {
      context.addIssue({ code: 'custom', message });
    }
  });

const checkEmail = (value: string): string | undefined => {
  const trimmed = trimWhiteSpace(value);
  if (trimmed === '') {
    return AUTH_FORM_MESSAGES.emailRequired;
  }
  if (trimmed.length > EMAIL_MAX_LENGTH) {
    return AUTH_FORM_MESSAGES.emailTooLong;
  }
  return z.regexes.html5Email.test(trimmed)
    ? undefined
    : AUTH_FORM_MESSAGES.emailFormat;
};

// 判定と送る値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const email = ruleOf(checkEmail).transform(trimWhiteSpace);

const newPassword = ruleOf((value) =>
  checkPasswordLength(value) === 'ok'
    ? undefined
    : AUTH_FORM_MESSAGES.passwordLength,
);

// 登録済みのパスワードの照合では下限を問わない
const currentPassword = ruleOf((value) => {
  if (value === '') {
    return AUTH_FORM_MESSAGES.passwordRequired;
  }
  return countCodePoints(value) > PASSWORD_MAX_CODE_POINTS
    ? AUTH_FORM_MESSAGES.passwordLength
    : undefined;
});

const secondFactorCode = (requiredMessage: string) =>
  ruleOf((value) => {
    if (trimWhiteSpace(value) === '') {
      return requiredMessage;
    }
    return value.length > SECOND_FACTOR_INPUT_MAX_LENGTH
      ? AUTH_FORM_MESSAGES.secondFactorIncorrect
      : undefined;
  });

export const LOGIN_FORM_SCHEMA = z.object({
  email,
  password: currentPassword,
});

export type LoginFormInput = z.input<typeof LOGIN_FORM_SCHEMA>;

export const PASSWORD_RESET_REQUEST_FORM_SCHEMA = z.object({ email });

export type PasswordResetRequestFormInput = z.input<
  typeof PASSWORD_RESET_REQUEST_FORM_SCHEMA
>;

// リンクのトークンは入力欄を描かないため含めず、送信の時に足す
export const NEW_PASSWORD_FORM_SCHEMA = z.object({ newPassword });

export type NewPasswordFormInput = z.input<typeof NEW_PASSWORD_FORM_SCHEMA>;

// 両方の欄の既定値を持ち、描いている一方だけをスキーマに含める
export interface SecondFactorFormInput {
  readonly secondFactor: {
    readonly totpCode?: string;
    readonly recoveryCode?: string;
  };
}

export type SecondFactorFormValues =
  | { readonly secondFactor: { readonly totpCode: string } }
  | { readonly secondFactor: { readonly recoveryCode: string } };

export type SecondFactorFormSchema = z.ZodType<
  SecondFactorFormValues,
  SecondFactorFormInput
>;

export const TOTP_CODE_FORM_SCHEMA: SecondFactorFormSchema = z.object({
  secondFactor: z.object({
    totpCode: secondFactorCode(AUTH_FORM_MESSAGES.totpCodeRequired),
  }),
});

export const RECOVERY_CODE_FORM_SCHEMA: SecondFactorFormSchema = z.object({
  secondFactor: z.object({
    recoveryCode: secondFactorCode(AUTH_FORM_MESSAGES.recoveryCodeRequired),
  }),
});

// 判定と送る値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const nickname = ruleOf((value) => {
  const violation = checkAdminNickname(value);
  if (violation === undefined) {
    return undefined;
  }
  return violation === 'empty'
    ? AUTH_FORM_MESSAGES.nicknameRequired
    : AUTH_FORM_MESSAGES.nicknameTooLong;
}).transform(trimWhiteSpace);

// リンクのトークンは入力欄を描かないため含めず、送信の時に足す
export const INVITATION_PROFILE_FORM_SCHEMA = z.object({
  nickname,
  password: newPassword,
});

export type InvitationProfileFormInput = z.input<
  typeof INVITATION_PROFILE_FORM_SCHEMA
>;

export const INVITATION_TOTP_FORM_SCHEMA = z.object({
  totpCode: secondFactorCode(AUTH_FORM_MESSAGES.totpCodeRequired),
});

export type InvitationTotpFormInput = z.input<
  typeof INVITATION_TOTP_FORM_SCHEMA
>;
