import { z } from 'zod';

import {
  AUDIT_REASON_MAX,
  checkAuditReason,
} from '../../../../../common-lib/admin/admin-input-rules.ts';
import { inputRuleOf } from '../../auth-inputs.ts';
import {
  businessDateArg,
  startTournamentCheckoutArgsOf,
} from '../tournament/inputs.ts';
import { LAUNCH_ID_INVALID_MESSAGE } from './errors.ts';

const EXPECTED_VERSION_TOO_SMALL_MESSAGE =
  '版は0以上の整数で指定してください。';

const REASON_TOO_LONG_MESSAGE = `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`;

export const START_YEAR_TOURNAMENT_CHECKOUT_ARGS =
  startTournamentCheckoutArgsOf(LAUNCH_ID_INVALID_MESSAGE);

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
    finalDate: businessDateArg,
    expectedVersion: z.int().min(0, EXPECTED_VERSION_TOO_SMALL_MESSAGE),
    reason,
  }),
});
