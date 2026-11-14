import {
  AppError,
  type AppErrorKind,
} from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';

interface NotificationsErrorDefinition {
  readonly kind: AppErrorKind;
  readonly message: string;
}

export const NOTIFICATIONS_ERRORS = Object.freeze({
  account_unavailable: IDENTITY_ERRORS.account_unavailable,
  invalid_link: IDENTITY_ERRORS.invalid_link,
  version_conflict: {
    kind: 'conflict',
    message:
      '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。',
  },
} satisfies Readonly<Record<string, NotificationsErrorDefinition>>);

export type NotificationsErrorCode = keyof typeof NOTIFICATIONS_ERRORS;

export const notificationsError = (code: NotificationsErrorCode): AppError => {
  const { kind, message } = NOTIFICATIONS_ERRORS[code];
  return new AppError({ kind, code, message });
};
