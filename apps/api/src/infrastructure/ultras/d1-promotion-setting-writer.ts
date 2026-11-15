import { eq, type SQL, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import { ULTRAS_PROMOTION_FLAG_KEY } from '../../../common-lib/ultras/promotion-flag.ts';
import type { Database } from '../../../db/client.ts';
import { ultrasSettings } from '../../../db/schema/ultras/ultras-settings.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  PromotionSettingReader,
  PromotionSettingRecord,
  PromotionSettingUpdate,
  PromotionSettingWriter,
} from '../../application/ultras/promotion-setting-ports.ts';
import { ultrasError } from '../../application/ultras/ultras-errors.ts';
import {
  buildAuditLogStatements,
  isAuditGuardRejection,
} from '../admin/audit-log-statements.ts';

const RECORD_COLUMNS = {
  id: ultrasSettings.id,
  enabled: ultrasSettings.enabled,
  version: ultrasSettings.version,
  updatedAt: ultrasSettings.updatedAt,
  updatedByAdminId: ultrasSettings.updatedByAdminId,
};

const promotionFlag = eq(ultrasSettings.settingKey, ULTRAS_PROMOTION_FLAG_KEY);

// 鍵の行が読み取った版のままであること。監査ログの条件は書き込みの時点で評価され、偽なら設定の更新も含めて一括の書き込み全体が取り消される
const stillAtVersion = (expectedVersion: number): SQL =>
  sql`${promotionFlag} AND ${ultrasSettings.version} = ${expectedVersion}`;

const rowExists = (condition: SQL): SQL =>
  sql`EXISTS (SELECT 1 FROM ${ultrasSettings} WHERE ${condition})`;

@injectable()
export class D1PromotionSettingWriter
  implements PromotionSettingReader, PromotionSettingWriter
{
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async read(): Promise<PromotionSettingRecord | undefined> {
    const [row] = await this.db
      .select(RECORD_COLUMNS)
      .from(ultrasSettings)
      .where(promotionFlag)
      .limit(1);
    return row;
  }

  async write(
    update: PromotionSettingUpdate,
    audit: PreparedAuditEntry,
  ): Promise<void> {
    const matches = stillAtVersion(update.expectedVersion);
    try {
      await this.db.batch([
        ...buildAuditLogStatements(this.db, audit, {
          kind: 'condition',
          condition: rowExists(matches),
        }),
        this.db
          .update(ultrasSettings)
          .set({
            enabled: update.enabled,
            version: sql`${ultrasSettings.version} + 1`,
            updatedByAdminId: update.adminId,
            updatedAt: update.now,
          })
          .where(matches),
      ]);
    } catch (error) {
      if (isAuditGuardRejection(error)) {
        throw ultrasError('version_conflict');
      }
      throw error;
    }
  }
}
