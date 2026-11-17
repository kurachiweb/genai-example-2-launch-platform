import { z } from 'zod';

import {
  AUDIT_REASON_MAX,
  checkAuditReason,
} from '../../../../../common-lib/admin/admin-input-rules.ts';
import { UPPERCASE_ULID_PATTERN } from '../../../../../lib/core/ids/uppercase-ulid.ts';
import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';
import { inputRuleOf } from '../../auth-inputs.ts';
import { LAUNCH_ID_INVALID_MESSAGE } from './errors.ts';

const DATE_INVALID_MESSAGE = '日付の指定が正しくありません。';

const EXPECTED_VERSION_TOO_SMALL_MESSAGE =
  '版は0以上の整数で指定してください。';

const REASON_TOO_LONG_MESSAGE = `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`;

// 画面は業務日付を自ら求めて渡すため、形式の違反と存在しない日付は同じ文言で拒否する
const businessDate = z.string().transform((value, context) => {
  try {
    return parseBusinessDate(value);
  } catch {
    context.addIssue({ code: 'custom', message: DATE_INVALID_MESSAGE });
    return z.NEVER;
  }
});

export const YEAR_TOURNAMENT_BOARD_ARGS = z.object({ date: businessDate });

// 欄ごとの詳細を1件にするため、ULIDの形式の違反で大文字の検査を止める
export const START_YEAR_TOURNAMENT_CHECKOUT_ARGS = z.object({
  launchId: z
    .ulid({ error: LAUNCH_ID_INVALID_MESSAGE, abort: true })
    .regex(UPPERCASE_ULID_PATTERN, LAUNCH_ID_INVALID_MESSAGE),
});

// 理由の未入力は操作種別が許すため、ここでは上限だけを確かめる
const reason = inputRuleOf((value) =>
  checkAuditReason(value) === undefined ? undefined : REASON_TOO_LONG_MESSAGE,
)
  .nullish()
  .transform((value) => value ?? undefined);

// 対象年と日付の選び方の規則はユースケースが判定し、理由のコードを返す
export const UPDATE_YEAR_FINAL_DATE_ARGS = z.object({
  input: z.object({
    year: z.int(),
    finalDate: businessDate,
    expectedVersion: z.int().min(0, EXPECTED_VERSION_TOO_SMALL_MESSAGE),
    reason,
  }),
});
