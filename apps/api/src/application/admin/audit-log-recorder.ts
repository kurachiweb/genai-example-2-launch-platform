import { inject, injectable } from 'inversify';

import { AUDIT_REASON_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
import type { AuditActionCatalog } from '../../../common-lib/admin/audit-action.ts';
import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import {
  type AuditEntryViolation,
  validateAuditEntry,
} from '../../domain/admin/audit-entry.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type { AuditLogStore } from './ports.ts';

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

export const AUDIT_REASON_TOO_LONG_MESSAGE = `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`;

const VIOLATION_DETAILS: Readonly<
  Record<
    AuditEntryViolation,
    { readonly field: string; readonly message: string }
  >
> = Object.freeze({
  unknown_action: {
    field: 'action',
    message: '操作種別が登録されていません。',
  },
  reason_required: { field: 'reason', message: '理由を入力してください。' },
  reason_not_allowed: {
    field: 'reason',
    message: 'この操作には理由を入力できません。',
  },
  reason_too_long: { field: 'reason', message: AUDIT_REASON_TOO_LONG_MESSAGE },
  invalid_target: {
    field: 'targets',
    message: '対象の識別子の形式が正しくありません。',
  },
  too_many_targets: {
    field: 'targets',
    message: '対象の件数が上限を超えています。',
  },
  targets_not_allowed: {
    field: 'targets',
    message: 'この操作には対象を指定できません。',
  },
  invalid_detail: {
    field: 'detail',
    message: '詳細の内容が正しくありません。',
  },
});

const logger = getAppLogger(['api', 'admin', 'audit-log']);

const auditEntryValidationError = (
  violation: AuditEntryViolation,
): AppError => {
  const { field, message } = VIOLATION_DETAILS[violation];
  return new AppError({
    kind: 'bad_request',
    code: 'validation_error',
    message: VALIDATION_ERROR_MESSAGE,
    details: [{ field, code: violation, message }],
  });
};

@injectable()
export class StoreAuditLogRecorder implements AuditLogRecorder {
  constructor(
    @inject(ADMIN_TYPES.AuditActionCatalog)
    private readonly catalog: AuditActionCatalog,
    @inject(PLATFORM_TYPES.IdGenerator)
    private readonly ids: IdGenerator,
    @inject(ADMIN_TYPES.AuditLogStore)
    private readonly store: AuditLogStore,
  ) {}

  prepare(entry: AuditEntryInput): PreparedAuditEntry {
    // 対象は集合として記録するため、同じIDを重ねて保存せず、上限も重複を除いた件数で数える
    const targetIds = Object.freeze([...new Set(entry.targetIds)]);
    const validation = validateAuditEntry(
      { ...entry, targetIds },
      this.catalog,
    );
    if (!validation.ok) {
      logger.warning('監査ログの記録の入力が規則に違反しています', {
        action: entry.action,
        violation: validation.violation,
      });
      throw auditEntryValidationError(validation.violation);
    }
    const action = this.catalog.find(entry.action);
    // 準備済みの印は型だけのため、検証を経たこの値にだけ型の表明で付ける
    return Object.freeze({
      id: this.ids.generate(),
      operatorAdminId: entry.operatorAdminId,
      action: entry.action,
      targetKind: targetIds.length === 0 ? null : (action?.targetKind ?? null),
      targetIds,
      reason: validation.reason,
      detail: Object.freeze({ ...entry.detail }),
      occurredAt: entry.occurredAt,
    }) as PreparedAuditEntry;
  }

  async record(entry: AuditEntryInput): Promise<void> {
    await this.store.insert(this.prepare(entry));
  }
}
