import { eq, type SQL, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notificationSenderSettings } from '../../../db/schema/notifications/notification-sender-settings.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { SENDER_INFO_SETTING_KEY } from '../../../lib/workers/notifications/d1-sender-info-store.ts';
import type {
  SenderInfoSave,
  SenderInfoWriter,
} from '../../application/notifications/ports.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from '../admin/audit-log-statements.ts';

const senderInfoRow = eq(
  notificationSenderSettings.settingKey,
  SENDER_INFO_SETTING_KEY,
);

// 設定の行が読み取った版のままであること。監査ログの条件は書き込みの時点で評価され、偽なら設定の更新も含めて一括の書き込み全体が取り消される
const stillAtVersion = (expectedVersion: number): SQL =>
  sql`${senderInfoRow} AND ${notificationSenderSettings.version} = ${expectedVersion}`;

const rowExists = (condition: SQL): SQL =>
  sql`EXISTS (SELECT 1 FROM ${notificationSenderSettings} WHERE ${condition})`;

// 行はシードのマイグレーションが作るため、初回の保存も版0を条件にした更新になる
@injectable()
export class D1SenderInfoWriter implements SenderInfoWriter {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async save(input: SenderInfoSave): Promise<'saved' | 'version_conflict'> {
    const matches = stillAtVersion(input.expectedVersion);
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, input.audit, {
          kind: 'condition',
          condition: rowExists(matches),
        }),
        this.db
          .update(notificationSenderSettings)
          .set({
            businessName: input.info.businessName,
            contactEmail: input.info.contactEmail,
            postalAddress: input.info.postalAddress,
            version: sql`${notificationSenderSettings.version} + 1`,
            updatedByAdminId: input.adminId,
            updatedAt: input.at,
          })
          .where(matches),
      ]);
      return 'saved';
    } catch (error) {
      if (isAuditGuardRejection(error)) {
        return 'version_conflict';
      }
      throw error;
    }
  }
}
