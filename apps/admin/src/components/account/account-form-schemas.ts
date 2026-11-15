import { z } from '../../../lib/utilities/validation/zod.ts';
import {
  CURRENT_PASSWORD_INPUT_SCHEMA,
  EMAIL_INPUT_SCHEMA,
  NEW_PASSWORD_INPUT_SCHEMA,
  RECOVERY_CODE_INPUT_SCHEMA,
  TOTP_CODE_INPUT_SCHEMA,
} from '../auth/auth-form-schemas.ts';

// 管理者は多要素認証を必ず有効にしているため、本人確認は現在のパスワードと、認証コードかリカバリコードの描いている一方を持つ
export type ReauthenticationMode = 'totp' | 'recovery';

// 両方の欄の既定値を持ち、描いている一方だけをスキーマに含める
export interface ReauthenticationInput {
  readonly currentPassword: string;
  readonly secondFactor: {
    readonly totpCode?: string;
    readonly recoveryCode?: string;
  };
}

export type ReauthenticationValues =
  | {
      readonly currentPassword: string;
      readonly secondFactor: { readonly totpCode: string };
    }
  | {
      readonly currentPassword: string;
      readonly secondFactor: { readonly recoveryCode: string };
    };

// APIの本人確認の詳細の経路(reAuthentication.currentPasswordなど)とそろうよう、引数と同じ名前の入れ子にする
const REAUTHENTICATION_SHAPES = Object.freeze({
  totp: z.object({
    currentPassword: CURRENT_PASSWORD_INPUT_SCHEMA,
    secondFactor: z.object({ totpCode: TOTP_CODE_INPUT_SCHEMA }),
  }),
  recovery: z.object({
    currentPassword: CURRENT_PASSWORD_INPUT_SCHEMA,
    secondFactor: z.object({ recoveryCode: RECOVERY_CODE_INPUT_SCHEMA }),
  }),
});

const byMode = <TSchema>(
  build: (mode: ReauthenticationMode) => TSchema,
): Readonly<Record<ReauthenticationMode, TSchema>> =>
  Object.freeze({ totp: build('totp'), recovery: build('recovery') });

export interface ReauthenticationFormInput {
  readonly reAuthentication: ReauthenticationInput;
}

export type ReauthenticationFormSchema = z.ZodType<
  { readonly reAuthentication: ReauthenticationValues },
  ReauthenticationFormInput
>;

// 入力が本人確認だけの操作(多要素認証の再設定の開始・リカバリコードの再発行)のスキーマ
export const REAUTHENTICATION_FORM_SCHEMAS = byMode<ReauthenticationFormSchema>(
  (mode) => z.object({ reAuthentication: REAUTHENTICATION_SHAPES[mode] }),
);

export interface EmailChangeFormInput extends ReauthenticationFormInput {
  readonly newEmail: string;
}

export type EmailChangeFormSchema = z.ZodType<
  {
    readonly newEmail: string;
    readonly reAuthentication: ReauthenticationValues;
  },
  EmailChangeFormInput
>;

export const EMAIL_CHANGE_FORM_SCHEMAS = byMode<EmailChangeFormSchema>((mode) =>
  z.object({
    newEmail: EMAIL_INPUT_SCHEMA,
    reAuthentication: REAUTHENTICATION_SHAPES[mode],
  }),
);

export interface PasswordChangeFormInput extends ReauthenticationFormInput {
  readonly newPassword: string;
}

export type PasswordChangeFormSchema = z.ZodType<
  {
    readonly newPassword: string;
    readonly reAuthentication: ReauthenticationValues;
  },
  PasswordChangeFormInput
>;

export const PASSWORD_CHANGE_FORM_SCHEMAS = byMode<PasswordChangeFormSchema>(
  (mode) =>
    z.object({
      newPassword: NEW_PASSWORD_INPUT_SCHEMA,
      reAuthentication: REAUTHENTICATION_SHAPES[mode],
    }),
);

export const TOTP_RESET_FORM_SCHEMA = z.object({
  totpCode: TOTP_CODE_INPUT_SCHEMA,
});

export type TotpResetFormInput = z.input<typeof TOTP_RESET_FORM_SCHEMA>;

export const REAUTHENTICATION_DEFAULT_VALUES: ReauthenticationInput =
  Object.freeze({
    currentPassword: '',
    secondFactor: { totpCode: '', recoveryCode: '' },
  });

// 本人確認の欄の名前。キーをパスワードの名前にするとシークレットの検出が値として誤検知するため、currentにする
export const REAUTHENTICATION_FIELD_NAMES = Object.freeze({
  current: 'reAuthentication.currentPassword',
  totpCode: 'reAuthentication.secondFactor.totpCode',
  recoveryCode: 'reAuthentication.secondFactor.recoveryCode',
} as const);
