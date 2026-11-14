import { inject, injectable } from 'inversify';

import { INQUIRY_STATUS_CHANGE_ACTION } from '../../../common-lib/admin/audit-actions/inquiry-chat.ts';
import type { InquiryStatus } from '../../../common-lib/inquiry/inquiry-status.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { checkStatusChangeable } from '../../domain/inquiry/inquiry-status-rules.ts';
import { inquiryError, inquiryStatusUnchangedError } from './inquiry-errors.ts';
import { INQUIRY_TYPES } from './inquiry-types.ts';
import type {
  AdminInquiryDetail,
  InquiryAdminReader,
  InquiryStatusStore,
  InquiryStatusTarget,
} from './ports.ts';

export interface InquiryStatusChangeInput {
  readonly inquiryId: string;
  readonly status: InquiryStatus;
  readonly reason?: string;
}

export interface InquiryStatusService {
  // モデレーター以上の認可を通したリゾルバから呼ぶ。ログイン・未ログインのどちらの問い合わせも変更でき、変更後の問い合わせを返す
  change(
    current: CurrentAdmin,
    input: InquiryStatusChangeInput,
  ): Promise<AdminInquiryDetail>;
}

const reasonOf = (reason: string | undefined): { readonly reason?: string } =>
  reason === undefined ? {} : { reason };

const targetOf = (detail: AdminInquiryDetail): InquiryStatusTarget => ({
  kind: detail.kind,
  id: detail.inquiry.id,
  status: detail.inquiry.status,
  // ログインの問い合わせの論理削除は退会の確定でだけ行う
  withdrawn: detail.kind === 'member' && detail.inquiry.deletedAt !== null,
});

const changedDetailOf = (
  detail: AdminInquiryDetail,
  status: InquiryStatus,
  at: Date,
): AdminInquiryDetail =>
  detail.kind === 'member'
    ? {
        kind: 'member',
        inquiry: { ...detail.inquiry, status, statusChangedAt: at },
      }
    : {
        kind: 'guest',
        inquiry: { ...detail.inquiry, status, statusChangedAt: at },
      };

@injectable()
export class StoreInquiryStatusService implements InquiryStatusService {
  constructor(
    @inject(INQUIRY_TYPES.InquiryAdminReader)
    private readonly reader: InquiryAdminReader,
    @inject(INQUIRY_TYPES.InquiryStatusStore)
    private readonly store: InquiryStatusStore,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async change(
    current: CurrentAdmin,
    input: InquiryStatusChangeInput,
  ): Promise<AdminInquiryDetail> {
    const detail = await this.reader.findDetail(input.inquiryId);
    if (detail === undefined) {
      throw inquiryError('inquiry_not_found');
    }
    const target = targetOf(detail);
    const denial = checkStatusChangeable(target, input.status);
    if (denial === 'withdrawn') {
      throw inquiryError('inquiry_read_only');
    }
    if (denial === 'unchanged') {
      throw inquiryStatusUnchangedError();
    }
    const at = this.clock.now();
    const audit = this.auditLog.prepare({
      operatorAdminId: current.id,
      action: INQUIRY_STATUS_CHANGE_ACTION.name,
      targetIds: [target.id],
      ...reasonOf(input.reason),
      detail: {
        kind: target.kind,
        fromStatus: target.status,
        toStatus: input.status,
      },
      occurredAt: at,
    });
    const result = await this.store.change(target, input.status, at, audit);
    if (result === 'conflict') {
      throw inquiryError('inquiry_state_conflict');
    }
    return changedDetailOf(detail, input.status, at);
  }
}
