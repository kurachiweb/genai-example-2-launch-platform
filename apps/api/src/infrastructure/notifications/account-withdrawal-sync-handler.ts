import { and, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notificationNotices } from '../../../db/schema/notifications/notification-notices.ts';
import { notificationPreferences } from '../../../db/schema/notifications/notification-preferences.ts';
import { notificationUnsubscribeTokens } from '../../../db/schema/notifications/notification-unsubscribe-tokens.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';

// 停止中の利用者の受信設定とトークンは停止の解除の後も使うため、退会だけを扱う
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
        .delete(notificationUnsubscribeTokens)
        .where(eq(notificationUnsubscribeTokens.userId, event.userId)),
      db
        .delete(notificationPreferences)
        .where(eq(notificationPreferences.userId, event.userId)),
      db
        .update(notificationNotices)
        .set({
          status: 'skipped',
          skipReason: 'recipient_withdrawn',
          settledAt: event.occurredAt,
          updatedAt: event.occurredAt,
        })
        .where(
          and(
            eq(notificationNotices.recipientUserId, event.userId),
            eq(notificationNotices.status, 'pending'),
          ),
        ),
    ]);
  }
}
