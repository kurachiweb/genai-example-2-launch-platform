import { eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notificationSenderSettings } from '../../../db/schema/notifications/notification-sender-settings.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { SenderInfo } from '../../core/email/ports.ts';
import type {
  SenderInfoRecord,
  SenderInfoStore,
} from '../../core/notifications/ports.ts';

export const SENDER_INFO_SETTING_KEY = 'sender-info';

interface SenderInfoColumns {
  readonly businessName: string | null;
  readonly contactEmail: string | null;
  readonly postalAddress: string | null;
}

// 版0は3項目がNULLで、版1以上は3項目がNOT NULLであることをCHECK制約が保証する
function senderInfoOf(row: SenderInfoColumns): SenderInfo | undefined {
  const { businessName, contactEmail, postalAddress } = row;
  if (
    businessName === null ||
    contactEmail === null ||
    postalAddress === null
  ) {
    return undefined;
  }
  return { businessName, contactEmail, postalAddress };
}

@injectable()
export class D1SenderInfoStore implements SenderInfoStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async get(): Promise<SenderInfoRecord | undefined> {
    const [row] = await this.db
      .select({
        settingId: notificationSenderSettings.id,
        version: notificationSenderSettings.version,
        businessName: notificationSenderSettings.businessName,
        contactEmail: notificationSenderSettings.contactEmail,
        postalAddress: notificationSenderSettings.postalAddress,
        updatedAt: notificationSenderSettings.updatedAt,
        updatedByAdminId: notificationSenderSettings.updatedByAdminId,
      })
      .from(notificationSenderSettings)
      .where(eq(notificationSenderSettings.settingKey, SENDER_INFO_SETTING_KEY))
      .limit(1);
    if (row === undefined) {
      return undefined;
    }
    return {
      settingId: row.settingId,
      version: row.version,
      info: senderInfoOf(row),
      updatedAt: row.updatedAt,
      updatedByAdminId: row.updatedByAdminId,
    };
  }
}
