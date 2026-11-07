import { z } from 'zod';

import {
  AUDIT_REASON_MAX,
  checkAuditReason,
} from '../../../../../common-lib/admin/admin-input-rules.ts';
import { inputRuleOf } from '../../auth-inputs.ts';

// 入力の検証の失敗(validation_error)の欄ごとの文言。ユースケースが投げるエラーの文言はapplication層のultras-errors.tsにある
export const INPUT_MESSAGES = Object.freeze({
  expectedVersionTooSmall: '版は0以上の整数で指定してください。',
  reasonTooLong: `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`,
});

const expectedVersion = z.int().min(0, INPUT_MESSAGES.expectedVersionTooSmall);

// 理由の未入力は操作種別が許すため、ここでは上限だけを確かめる
const reason = inputRuleOf((value) =>
  checkAuditReason(value) === undefined
    ? undefined
    : INPUT_MESSAGES.reasonTooLong,
)
  .nullish()
  .transform((value) => value ?? undefined);

export const UPDATE_ULTRAS_PROMOTION_SETTING_ARGS = z.object({
  input: z.object({ enabled: z.boolean(), expectedVersion, reason }),
});
