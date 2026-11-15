import { and, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { launchComments } from '../../../db/schema/engagement/launch-comments.ts';
import { productRatings } from '../../../db/schema/engagement/product-ratings.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';

// 本人が先に削除したコメントの削除の日時は匿名化の起点になるため、論理削除済みの行を上書きしない
@injectable()
export class EngagementWithdrawalSyncHandler implements UserLifecycleSyncHandler {
  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'withdrawn') {
      return Promise.resolve([]);
    }
    const deletion = {
      deletedAt: event.occurredAt,
      updatedAt: event.occurredAt,
    };
    return Promise.resolve([
      db
        .update(launchComments)
        .set(deletion)
        .where(
          and(
            eq(launchComments.authorUserId, event.userId),
            notDeleted(launchComments.deletedAt),
          ),
        ),
      db
        .update(productRatings)
        .set(deletion)
        .where(
          and(
            eq(productRatings.userId, event.userId),
            notDeleted(productRatings.deletedAt),
          ),
        ),
    ]);
  }
}
