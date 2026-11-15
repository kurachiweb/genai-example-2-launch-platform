import { AUDIT_REASON_MAX } from '../../../../../common-lib/admin/admin-input-rules.ts';
import {
  SENDER_INFO_MAX_GRAPHEMES,
  type SenderInfoField,
} from '../../../../../common-lib/notifications/sender-info-input-rules.ts';
import { AppError } from '../../../../../lib/core/errors/app-error.ts';
import { authError } from '../../../../application/auth/auth-errors.ts';
import { NOTIFICATIONS_ERRORS } from '../../../../application/notifications/notifications-errors.ts';
import type { SenderInfoFieldViolation } from '../../../../application/notifications/sender-info-service.ts';
import { AUTH_INPUT_MESSAGES } from '../../auth-inputs.ts';

// 入力の検証の失敗(validation_error)の欄ごとの文言。ユースケースが投げるエラーの文言はapplication層のnotifications-errors.tsにある
export const INPUT_MESSAGES = Object.freeze({
  // 長さの違反するトークンも照合できないトークンと同じく無効なリンクとして示す
  unsubscribeTokenInvalid: NOTIFICATIONS_ERRORS.invalid_link.message,
  expectedVersionTooSmall: '版は0以上の整数で指定してください。',
  reasonTooLong: `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`,
});

const SENDER_INFO_FIELD_LABELS: Readonly<Record<SenderInfoField, string>> =
  Object.freeze({
    businessName: '事業者名',
    contactEmail: '連絡先メールアドレス',
    postalAddress: '物理的郵送先住所',
  });

const senderInfoMessageOf = ({
  field,
  reason,
}: SenderInfoFieldViolation): string => {
  switch (reason) {
    case 'empty':
      return `${SENDER_INFO_FIELD_LABELS[field]}を入力してください。`;
    case 'too-long':
      return `${SENDER_INFO_FIELD_LABELS[field]}は${String(SENDER_INFO_MAX_GRAPHEMES)}文字以内で入力してください。`;
    case 'invalid-email':
      return AUTH_INPUT_MESSAGES.emailFormat;
  }
};

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

// GraphQLの引数の検証(withValidatedArgs)と同じ形の詳細にする。欄は保存の入力からの相対の経路で、解決関数が引数の経路に直す
export const senderInfoValidationError = (
  violations: readonly SenderInfoFieldViolation[],
): AppError =>
  new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: violations.map((violation) => ({
      field: violation.field,
      code: violation.reason,
      message: senderInfoMessageOf(violation),
    })),
  });

export const callerForbiddenError = (): AppError => authError('forbidden');
