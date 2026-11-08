import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';

interface ProfileErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

// 利用者に見せる文言は文言規則のエラーメッセージと同じにする
export const PROFILE_ERRORS = Object.freeze({
  handle_unavailable: {
    kind: 'conflict',
    message: 'このハンドルは既に使われています。別の文字列を入力してください。',
  },
  profile_update_conflict: {
    kind: 'conflict',
    message:
      'プロフィールが別の画面で変更されました。最新の内容を読み込んでから保存してください。',
  },
  invalid_upload: {
    kind: 'unprocessable',
    message: 'プロフィール画像をもう一度選択してください。',
  },
  account_unavailable: IDENTITY_ERRORS.account_unavailable,
} satisfies Readonly<Record<string, ProfileErrorDefinition>>);

export type ProfileErrorCode = keyof typeof PROFILE_ERRORS;

export const profileError = (code: ProfileErrorCode): AppError => {
  const { kind, message } = PROFILE_ERRORS[code];
  if (code === 'handle_unavailable') {
    return new AppError({
      kind,
      code,
      message,
      details: [{ field: 'handle', code: 'unavailable', message }],
    });
  }
  return new AppError({ kind, code, message });
};
