import { and, eq, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';
import { waivedStopRefundStatus } from './stop-refund-waiver.ts';

@injectable()
export class AccountWithdrawalSyncHandler implements UserLifecycleSyncHandler {
  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'withdrawn') {
      return Promise.resolve([]);
    }
    return Promise.resolve([
      db
        .update(sponsorships)
        .set({
          deletedAt: event.occurredAt,
          stopRefundStatus: waivedStopRefundStatus(),
          updatedAt: event.occurredAt,
        })
        .where(
          and(
            eq(sponsorships.userId, event.userId),
            isNull(sponsorships.deletedAt),
          ),
        ),
    ]);
  }
}
