import { eq, or, and } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { userFollows } from '../../../db/schema/follow/user-follows.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import { previousHandleSoftDelete } from '../../../lib/workers/handles/previous-handle-statements.ts';
import { USER_HANDLE_NAMESPACE } from '../../../lib/workers/profile/user-handle-namespace.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';

@injectable()
export class ProfileWithdrawalSyncHandler implements UserLifecycleSyncHandler {
  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'withdrawn') {
      return Promise.resolve([]);
    }
    return Promise.resolve([
      previousHandleSoftDelete(db, USER_HANDLE_NAMESPACE, {
        ownerId: event.userId,
        now: event.occurredAt,
      }),
      db
        .update(userFollows)
        .set({ deletedAt: event.occurredAt, updatedAt: event.occurredAt })
        .where(
          and(
            or(
              eq(userFollows.followerId, event.userId),
              eq(userFollows.followeeId, event.userId),
            ),
            notDeleted(userFollows.deletedAt),
          ),
        ),
    ]);
  }
}
