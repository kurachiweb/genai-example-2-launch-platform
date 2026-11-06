import { eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import {
  ULTRAS_PROMOTION_FLAG_DEFAULT,
  ULTRAS_PROMOTION_FLAG_KEY,
} from '../../../common-lib/ultras/promotion-flag.ts';
import type { Database } from '../../../db/client.ts';
import { ultrasSettings } from '../../../db/schema/ultras/ultras-settings.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { UltrasPromotionFlagReader } from '../../core/ultras/ports.ts';

@injectable()
export class D1PromotionFlagReader implements UltrasPromotionFlagReader {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async isEnabled(): Promise<boolean> {
    const [row] = await this.db
      .select({ enabled: ultrasSettings.enabled })
      .from(ultrasSettings)
      .where(eq(ultrasSettings.settingKey, ULTRAS_PROMOTION_FLAG_KEY))
      .limit(1);
    return row?.enabled ?? ULTRAS_PROMOTION_FLAG_DEFAULT;
  }
}
