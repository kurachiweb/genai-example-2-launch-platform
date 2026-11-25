import {
  checkModerationReason,
  MODERATION_REASON_MESSAGES,
  type ModerationAction,
} from '../../../common-lib/moderation/moderation-actions.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

// 違反はAppError(bad_request, validation_error)で、詳細の欄はユースケースの入力からの相対の経路reasonにする。理由の無い任意の操作はnullを返す
export const normalizeModerationReason = (
  action: ModerationAction,
  reason: string | undefined,
): string | null => {
  const check = checkModerationReason(action, reason);
  const message = MODERATION_REASON_MESSAGES[check];
  if (check !== 'ok' && message !== undefined) {
    throw new AppError({
      kind: 'bad_request',
      code: 'validation_error',
      message: VALIDATION_ERROR_MESSAGE,
      details: [{ field: 'reason', code: check.replaceAll('-', '_'), message }],
    });
  }
  const normalized = trimWhiteSpace(reason ?? '');
  return normalized === '' ? null : normalized;
};
