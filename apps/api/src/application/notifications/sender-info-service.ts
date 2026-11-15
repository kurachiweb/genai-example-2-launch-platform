import { inject, injectable } from 'inversify';

import { NOTIFICATION_SENDER_UPDATE_ACTION } from '../../../common-lib/admin/audit-actions/notifications.ts';
import {
  checkSenderInfoLengths,
  type SenderInfoField,
} from '../../../common-lib/notifications/sender-info-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { isValidEmailAddress } from '../../../lib/core/email/email-address.ts';
import type { SenderInfo } from '../../../lib/core/email/ports.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type {
  SenderInfoRecord,
  SenderInfoStore,
} from '../../../lib/core/notifications/ports.ts';
import { notificationsError } from './notifications-errors.ts';
import { NOTIFICATIONS_TYPES } from './notifications-types.ts';
import type { SenderInfoWriter } from './ports.ts';

export interface SenderInfoView {
  // 未設定はnull
  readonly info: SenderInfo | null;
  // 未設定は0
  readonly version: number;
  // 版0はシードの作成の日時を最後に変更した日時として出さないためnull
  readonly updatedAt: Date | null;
  readonly updatedByAdminId: string | null;
}

export interface SenderInfoFieldViolation {
  readonly field: SenderInfoField;
  readonly reason: 'empty' | 'too-long' | 'invalid-email';
}

export type SenderInfoUpdateResult =
  | { readonly kind: 'saved'; readonly view: SenderInfoView }
  | {
      readonly kind: 'invalid';
      readonly violations: readonly SenderInfoFieldViolation[];
    };

export interface SenderInfoUpdateInput {
  // 解決関数が最上位管理者であることを確かめた管理者
  readonly adminId: string;
  readonly info: SenderInfo;
  readonly expectedVersion: number;
  readonly reason: string | undefined;
  readonly now: Date;
}

// 認可と変更者のニックネームの照会は解決関数が行う
export interface SenderInfoService {
  read(): Promise<SenderInfoView>;
  // 読み取った版と一致しなければAppError(conflict, version_conflict)
  update(input: SenderInfoUpdateInput): Promise<SenderInfoUpdateResult>;
}

const SENDER_INFO_FIELDS: readonly SenderInfoField[] = Object.freeze([
  'businessName',
  'contactEmail',
  'postalAddress',
]);

const UNSET_VIEW: SenderInfoView = Object.freeze({
  info: null,
  version: 0,
  updatedAt: null,
  updatedByAdminId: null,
});

const trimmedInfoOf = (info: SenderInfo): SenderInfo => ({
  businessName: trimWhiteSpace(info.businessName),
  contactEmail: trimWhiteSpace(info.contactEmail),
  postalAddress: trimWhiteSpace(info.postalAddress),
});

// 1つの項目には最初の違反だけを示すため、文字数の違反が無い連絡先メールアドレスだけ形式を判定する
const violationsOf = (
  info: SenderInfo,
): readonly SenderInfoFieldViolation[] => {
  const lengths = checkSenderInfoLengths(info);
  return SENDER_INFO_FIELDS.flatMap(
    (field): readonly SenderInfoFieldViolation[] => {
      const length = lengths.find((violation) => violation.field === field);
      if (length !== undefined) {
        return [length];
      }
      if (field === 'contactEmail' && !isValidEmailAddress(info.contactEmail)) {
        return [{ field, reason: 'invalid-email' }];
      }
      return [];
    },
  );
};

const changedFieldsOf = (
  current: SenderInfo | undefined,
  next: SenderInfo,
): string =>
  SENDER_INFO_FIELDS.filter((field) => current?.[field] !== next[field]).join(
    ',',
  );

const viewOf = (record: SenderInfoRecord | undefined): SenderInfoView => {
  if (record === undefined || record.version === 0) {
    return UNSET_VIEW;
  }
  return {
    info: record.info ?? null,
    version: record.version,
    updatedAt: record.updatedAt,
    updatedByAdminId: record.updatedByAdminId,
  };
};

@injectable()
export class StoreSenderInfoService implements SenderInfoService {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.SenderInfoStore)
    private readonly store: SenderInfoStore,
    @inject(NOTIFICATIONS_TYPES.SenderInfoWriter)
    private readonly writer: SenderInfoWriter,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
  ) {}

  async read(): Promise<SenderInfoView> {
    return viewOf(await this.store.get());
  }

  async update(input: SenderInfoUpdateInput): Promise<SenderInfoUpdateResult> {
    const info = trimmedInfoOf(input.info);
    const violations = violationsOf(info);
    if (violations.length > 0) {
      return { kind: 'invalid', violations };
    }
    const current = await this.store.get();
    if (current === undefined) {
      throw new Error('送信者情報の設定の行がありません');
    }
    // 送信者情報の値は監査ログに含めず、変更した項目の名前だけを残す
    const audit = this.auditLog.prepare({
      operatorAdminId: input.adminId,
      action: NOTIFICATION_SENDER_UPDATE_ACTION.name,
      targetIds: [current.settingId],
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      detail: { fields: changedFieldsOf(current.info, info) },
      occurredAt: input.now,
    });
    const result = await this.writer.save({
      info,
      expectedVersion: input.expectedVersion,
      adminId: input.adminId,
      audit,
      at: input.now,
    });
    if (result === 'version_conflict') {
      throw notificationsError('version_conflict');
    }
    return { kind: 'saved', view: await this.read() };
  }
}
