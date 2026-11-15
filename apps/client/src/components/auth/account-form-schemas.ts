import {
  checkNickname,
  checkPasswordLength,
  countCodePoints,
  EMAIL_MAX_LENGTH,
  NICKNAME_MAX_GRAPHEMES,
  PASSWORD_MAX_CODE_POINTS,
  PASSWORD_MIN_CODE_POINTS,
} from '../../../common-lib/identity/account-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';

// APIサーバーの入力の検証と同じ文言にする(文言規則のエラーメッセージ)
export const ACCOUNT_FORM_MESSAGES = Object.freeze({
  nicknameRequired: 'ニックネームを入力してください。',
  nicknameTooLong: `ニックネームは${String(NICKNAME_MAX_GRAPHEMES)}文字以内で入力してください。`,
  emailRequired: 'メールアドレスを入力してください。',
  emailTooLong: `メールアドレスは${String(EMAIL_MAX_LENGTH)}文字以内で入力してください。`,
  emailFormat: 'メールアドレスの形式が正しくありません。',
  passwordRequired: 'パスワードを入力してください。',
  passwordLength: `パスワードは${String(PASSWORD_MIN_CODE_POINTS)}文字以上${String(PASSWORD_MAX_CODE_POINTS)}文字以内で入力してください。`,
  termsNotAgreed: '利用規約とプライバシーポリシーに同意してください。',
  totpCodeRequired: '認証コードを入力してください。',
  recoveryCodeRequired: 'リカバリコードを入力してください。',
  secondFactorIncorrect: '認証コードが正しくありません。',
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

const NICKNAME_MESSAGES = Object.freeze({
  ok: undefined,
  empty: ACCOUNT_FORM_MESSAGES.nicknameRequired,
  'too-long': ACCOUNT_FORM_MESSAGES.nicknameTooLong,
});

// 判定と送る値を食い違わせないよう、入力規則と同じ空白の集合で前後を除く
const nickname = ruleOf(
  (value) => NICKNAME_MESSAGES[checkNickname(value)],
).transform(trimWhiteSpace);

const checkEmail = (value: string): string | undefined => {
  const trimmed = trimWhiteSpace(value);
  if (trimmed === '') {
    return ACCOUNT_FORM_MESSAGES.emailRequired;
  }
  if (trimmed.length > EMAIL_MAX_LENGTH) {
    return ACCOUNT_FORM_MESSAGES.emailTooLong;
  }
  return z.regexes.html5Email.test(trimmed)
    ? undefined
    : ACCOUNT_FORM_MESSAGES.emailFormat;
};

export const email = ruleOf(checkEmail).transform(trimWhiteSpace);

const newPassword = ruleOf((value) =>
  checkPasswordLength(value) === 'ok'
    ? undefined
    : ACCOUNT_FORM_MESSAGES.passwordLength,
);

// 登録済みのパスワードの照合では下限を問わない
const currentPassword = ruleOf((value) => {
  if (value === '') {
    return ACCOUNT_FORM_MESSAGES.passwordRequired;
  }
  return countCodePoints(value) > PASSWORD_MAX_CODE_POINTS
    ? ACCOUNT_FORM_MESSAGES.passwordLength
    : undefined;
});

const secondFactorCode = (requiredMessage: string) =>
  ruleOf((value) => {
    if (trimWhiteSpace(value) === '') {
      return requiredMessage;
    }
    return value.length > SECOND_FACTOR_INPUT_MAX_LENGTH
      ? ACCOUNT_FORM_MESSAGES.secondFactorIncorrect
      : undefined;
  });

export const REGISTER_FORM_SCHEMA = z.object({
  nickname,
  email,
  password: newPassword,
  agreedToTerms: z
    .boolean()
    .refine((agreed) => agreed, ACCOUNT_FORM_MESSAGES.termsNotAgreed),
});

export type RegisterFormInput = z.input<typeof REGISTER_FORM_SCHEMA>;

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
export const PASSWORD_RESET_FORM_SCHEMA = z.object({ newPassword });

export type PasswordResetFormInput = z.input<typeof PASSWORD_RESET_FORM_SCHEMA>;

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
    totpCode: secondFactorCode(ACCOUNT_FORM_MESSAGES.totpCodeRequired),
  }),
});

export const RECOVERY_CODE_FORM_SCHEMA: SecondFactorFormSchema = z.object({
  secondFactor: z.object({
    recoveryCode: secondFactorCode(ACCOUNT_FORM_MESSAGES.recoveryCodeRequired),
  }),
});

// 多要素認証が無効なら現在のパスワードだけ、有効なら認証コードとリカバリコードのうち描いている一方も持つ
export type ReauthenticationMode = 'password' | 'totp' | 'recovery';

// 全欄の既定値を持ち、描いている欄だけをスキーマに含める
export interface ReauthenticationFormInput {
  readonly currentPassword: string;
  readonly secondFactor?: {
    readonly totpCode?: string;
    readonly recoveryCode?: string;
  };
}

export type ReauthenticationFormValues =
  | { readonly currentPassword: string }
  | {
      readonly currentPassword: string;
      readonly secondFactor: { readonly totpCode: string };
    }
  | {
      readonly currentPassword: string;
      readonly secondFactor: { readonly recoveryCode: string };
    };

const REAUTHENTICATION_SHAPES = Object.freeze({
  password: z.object({ currentPassword }),
  totp: z.object({
    currentPassword,
    secondFactor: z.object({
      totpCode: secondFactorCode(ACCOUNT_FORM_MESSAGES.totpCodeRequired),
    }),
  }),
  recovery: z.object({
    currentPassword,
    secondFactor: z.object({
      recoveryCode: secondFactorCode(
        ACCOUNT_FORM_MESSAGES.recoveryCodeRequired,
      ),
    }),
  }),
});

const byMode = <TSchema>(
  build: (mode: ReauthenticationMode) => TSchema,
): Readonly<Record<ReauthenticationMode, TSchema>> =>
  Object.freeze({
    password: build('password'),
    totp: build('totp'),
    recovery: build('recovery'),
  });

export type ReauthenticationFormSchema = z.ZodType<
  ReauthenticationFormValues,
  ReauthenticationFormInput
>;

// 入力が本人確認だけの操作(退会・多要素認証の開始・無効化・リカバリコードの再発行)のスキーマ
export const REAUTHENTICATION_FORM_SCHEMAS = byMode<ReauthenticationFormSchema>(
  (mode) => REAUTHENTICATION_SHAPES[mode],
);

export type WithdrawalFormInput = ReauthenticationFormInput;

export type WithdrawalFormSchema = ReauthenticationFormSchema;

export const WITHDRAWAL_FORM_SCHEMAS = REAUTHENTICATION_FORM_SCHEMAS;

export const TOTP_ENABLE_FORM_SCHEMA = z.object({
  totpCode: secondFactorCode(ACCOUNT_FORM_MESSAGES.totpCodeRequired),
});

export type TotpEnableFormInput = z.input<typeof TOTP_ENABLE_FORM_SCHEMA>;

export interface EmailChangeFormInput {
  readonly newEmail: string;
  readonly reAuthentication: ReauthenticationFormInput;
}

export type EmailChangeFormSchema = z.ZodType<
  {
    readonly newEmail: string;
    readonly reAuthentication: ReauthenticationFormValues;
  },
  EmailChangeFormInput
>;

export const EMAIL_CHANGE_FORM_SCHEMAS = byMode<EmailChangeFormSchema>((mode) =>
  z.object({
    newEmail: email,
    reAuthentication: REAUTHENTICATION_SHAPES[mode],
  }),
);

export interface PasswordChangeFormInput {
  readonly newPassword: string;
  readonly reAuthentication: ReauthenticationFormInput;
}

export type PasswordChangeFormSchema = z.ZodType<
  {
    readonly newPassword: string;
    readonly reAuthentication: ReauthenticationFormValues;
  },
  PasswordChangeFormInput
>;

export const PASSWORD_CHANGE_FORM_SCHEMAS = byMode<PasswordChangeFormSchema>(
  (mode) =>
    z.object({ newPassword, reAuthentication: REAUTHENTICATION_SHAPES[mode] }),
);
