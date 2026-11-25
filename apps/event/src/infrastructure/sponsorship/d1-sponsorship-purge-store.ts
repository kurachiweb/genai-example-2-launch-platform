import { eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { SPONSORSHIP_PLATFORM_TYPES } from '../../../lib/core/sponsorship/identifiers.ts';
import type { DisplayStopStore } from '../../../lib/core/sponsorship/ports.ts';
import type { SponsorshipPurgeStore } from '../../application/sponsorship/ports.ts';

// 表示停止の区間は外部キーを持たないため、申込の行と別の書き込みで消す。どちらも残りの行を消すだけなので、途中で失敗しても再試行で消し切れる
@injectable()
export class D1SponsorshipPurgeStore implements SponsorshipPurgeStore {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(SPONSORSHIP_PLATFORM_TYPES.DisplayStopStore)
    private readonly displayStops: DisplayStopStore,
  ) {}

  async purgeByUser(userId: string): Promise<void> {
    await this.db.delete(sponsorships).where(eq(sponsorships.userId, userId));
    await this.displayStops.deleteSubject({ kind: 'user', userId });
  }

  async purgeByProduct(productId: string): Promise<void> {
    await this.db
      .delete(sponsorships)
      .where(eq(sponsorships.productId, productId));
    await this.displayStops.deleteSubject({ kind: 'product', productId });
  }
}
