import { inject, injectable } from 'inversify';

import { AUDIT_REASON_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
import type {
  AuditActionCatalog,
  AuditTargetKind,
} from '../../../common-lib/admin/audit-action.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import {
  type AuditEntryInput,
  type AuditEntryViolation,
  validateAuditEntry,
} from '../../domain/admin/audit-entry.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type { AuditLogStore } from './ports.ts';

// 検証を経ずに組み立てた値をストアへ渡せないよう、このモジュールだけが持つシンボルで準備済みの値を区別する
const PREPARED: unique symbol = Symbol('PreparedAuditEntry');

export interface PreparedAuditEntry {
  readonly [PREPARED]: true;
  readonly id: string;
  readonly operatorAdminId: string;
  readonly action: string;
  readonly targetKind: AuditTargetKind | null;
  readonly targetIds: readonly string[];
  readonly reason: string | null;
  readonly detail: Readonly<Record<string, string>>;
  readonly occurredAt: Date;
}

export interface AuditLogRecorder {
  // 管理操作の前に呼び、違反があれば操作を行わせない。結果は操作と同じ一括の書き込みでストアへ渡す
  prepare(entry: AuditEntryInput): PreparedAuditEntry;
  // 閲覧・検索のような記録だけの操作で、結果を返す前に単独で書く
  record(entry: AuditEntryInput): Promise<void>;
}

const VALIDATION_ERROR_MESSAGE = '入力内容を確認してください。';

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
  reason_too_long: {
    field: 'reason',
    message: `理由は${String(AUDIT_REASON_MAX)}文字以内で入力してください。`,
  },
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
    const prepared: PreparedAuditEntry = {
      [PREPARED]: true,
      id: this.ids.generate(),
      operatorAdminId: entry.operatorAdminId,
      action: entry.action,
      targetKind: targetIds.length === 0 ? null : (action?.targetKind ?? null),
      targetIds,
      reason: validation.reason,
      detail: Object.freeze({ ...entry.detail }),
      occurredAt: entry.occurredAt,
    };
    return Object.freeze(prepared);
  }

  async record(entry: AuditEntryInput): Promise<void> {
    await this.store.insert(this.prepare(entry));
  }
}
