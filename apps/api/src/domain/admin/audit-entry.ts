import { z } from 'zod';

import { checkAuditReason } from '../../../common-lib/admin/admin-input-rules.ts';
import type {
  AuditActionCatalog,
  AuditActionDefinition,
} from '../../../common-lib/admin/audit-action.ts';
import { countGraphemes } from '../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type { AuditEntryInput } from '../../../lib/core/admin/audit-log.ts';

export type AuditEntryViolation =
  | 'unknown_action'
  | 'reason_required'
  | 'reason_not_allowed'
  | 'reason_too_long'
  | 'invalid_target'
  | 'too_many_targets'
  | 'targets_not_allowed'
  | 'invalid_detail';

export type AuditEntryValidation =
  | { readonly ok: true; readonly reason: string | null }
  | { readonly ok: false; readonly violation: AuditEntryViolation };

const AUDIT_DETAIL_VALUE_MAX = 100;

// 利用者の対象は登録時に生成する仮名化ID(UUID)だけを受け付け、メールアドレスなどの個人情報が監査ログへ入らないようにする
const USER_TARGET_ID = z.uuid();

const NON_USER_TARGET_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/u;

const violation = (kind: AuditEntryViolation): AuditEntryValidation => ({
  ok: false,
  violation: kind,
});

const checkReason = (
  action: AuditActionDefinition,
  reason: string | undefined,
): AuditEntryViolation | undefined => {
  const trimmed = trimWhiteSpace(reason ?? '');
  if (trimmed === '') {
    return action.reason === 'required' ? 'reason_required' : undefined;
  }
  if (action.reason === 'none') {
    return 'reason_not_allowed';
  }
  return checkAuditReason(trimmed) === 'too-long'
    ? 'reason_too_long'
    : undefined;
};

const isValidTargetId = (
  action: AuditActionDefinition,
  targetId: string,
): boolean =>
  action.targetKind === 'user'
    ? USER_TARGET_ID.safeParse(targetId).success
    : NON_USER_TARGET_ID_PATTERN.test(targetId);

const checkTargets = (
  action: AuditActionDefinition,
  targetIds: readonly string[],
): AuditEntryViolation | undefined => {
  if (targetIds.length === 0) {
    return undefined;
  }
  if (action.targetKind === null) {
    return 'targets_not_allowed';
  }
  if (targetIds.length > action.maxTargets) {
    return 'too_many_targets';
  }
  return targetIds.every((targetId) => isValidTargetId(action, targetId))
    ? undefined
    : 'invalid_target';
};

const checkDetail = (
  action: AuditActionDefinition,
  detail: Readonly<Record<string, string>> | undefined,
): AuditEntryViolation | undefined => {
  const allowedKeys = new Set(action.detailKeys);
  const isValid = Object.entries(detail ?? {}).every(
    ([key, value]: [string, unknown]) =>
      allowedKeys.has(key) &&
      typeof value === 'string' &&
      countGraphemes(value) <= AUDIT_DETAIL_VALUE_MAX,
  );
  return isValid ? undefined : 'invalid_detail';
};

export const validateAuditEntry = (
  entry: AuditEntryInput,
  catalog: AuditActionCatalog,
): AuditEntryValidation => {
  const action = catalog.find(entry.action);
  if (action === undefined) {
    return violation('unknown_action');
  }
  const found =
    checkReason(action, entry.reason) ??
    checkTargets(action, entry.targetIds) ??
    checkDetail(action, entry.detail);
  if (found !== undefined) {
    return violation(found);
  }
  const reason = trimWhiteSpace(entry.reason ?? '');
  return { ok: true, reason: reason === '' ? null : reason };
};
