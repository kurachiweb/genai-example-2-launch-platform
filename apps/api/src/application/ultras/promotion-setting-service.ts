import { inject, injectable } from 'inversify';

import { ULTRAS_PROMOTION_UPDATE_ACTION } from '../../../common-lib/admin/audit-actions/ultras-subscription.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { ULTRAS_PROMOTION_FLAG_DEFAULT } from '../../../common-lib/ultras/promotion-flag.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import type { AdminDirectory } from '../../../lib/core/admin/ports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  PromotionSettingReader,
  PromotionSettingRecord,
  PromotionSettingWriter,
} from './promotion-setting-ports.ts';
import { API_ULTRAS_TYPES } from './ultras-types.ts';

export interface PromotionSettingView {
  readonly enabled: boolean;
  readonly version: number;
  // 設定の行が無ければnull
  readonly updatedAt: Date | null;
  // 管理者がまだ変更していない、または最後に変更した管理者が削除済みならnull
  readonly updatedByNickname: string | null;
}

export interface PromotionSettingUpdateInput {
  readonly adminId: string;
  readonly enabled: boolean;
  readonly expectedVersion: number;
  readonly reason?: string | undefined;
}

export interface PromotionSettingService {
  // 認可は解決関数が行う。照会は閲覧のみ以上、変更は最上位管理者のIDを受け取る
  read(): Promise<PromotionSettingView>;
  // 読み取った版と一致しなければAppError(conflict, version_conflict)
  update(input: PromotionSettingUpdateInput): Promise<PromotionSettingView>;
}

// 一度も設定されていない環境はオフとして扱う
const DEFAULT_VIEW: PromotionSettingView = Object.freeze({
  enabled: ULTRAS_PROMOTION_FLAG_DEFAULT,
  version: 0,
  updatedAt: null,
  updatedByNickname: null,
});

const reasonOf = (reason: string | undefined): { readonly reason?: string } =>
  reason === undefined || trimWhiteSpace(reason) === '' ? {} : { reason };

@injectable()
export class DefaultPromotionSettingService implements PromotionSettingService {
  constructor(
    @inject(API_ULTRAS_TYPES.PromotionSettingReader)
    private readonly reader: PromotionSettingReader,
    @inject(API_ULTRAS_TYPES.PromotionSettingWriter)
    private readonly writer: PromotionSettingWriter,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
    @inject(ADMIN_PLATFORM_TYPES.AdminDirectory)
    private readonly directory: AdminDirectory,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async read(): Promise<PromotionSettingView> {
    const record = await this.reader.read();
    return record === undefined ? DEFAULT_VIEW : this.toView(record);
  }

  async update(
    input: PromotionSettingUpdateInput,
  ): Promise<PromotionSettingView> {
    const current = await this.reader.read();
    if (current === undefined) {
      throw new Error('機能フラグの設定の行がありません');
    }
    const now = this.clock.now();
    const audit = this.auditLog.prepare({
      operatorAdminId: input.adminId,
      action: ULTRAS_PROMOTION_UPDATE_ACTION.name,
      targetIds: [current.id],
      ...reasonOf(input.reason),
      detail: { enabled: String(input.enabled) },
      occurredAt: now,
    });
    await this.writer.write(
      {
        enabled: input.enabled,
        expectedVersion: input.expectedVersion,
        adminId: input.adminId,
        now,
      },
      audit,
    );
    return this.read();
  }

  private async toView(
    record: PromotionSettingRecord,
  ): Promise<PromotionSettingView> {
    return {
      enabled: record.enabled,
      version: record.version,
      updatedAt: record.updatedAt,
      updatedByNickname: await this.nicknameOf(record.updatedByAdminId),
    };
  }

  private async nicknameOf(adminId: string | null): Promise<string | null> {
    if (adminId === null) {
      return null;
    }
    const profiles = await this.directory.findProfiles([adminId]);
    return profiles.get(adminId)?.nickname ?? null;
  }
}
