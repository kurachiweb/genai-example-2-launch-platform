import { and, eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { memberInquiries } from '../../../db/schema/inquiry/member-inquiries.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';

@injectable()
export class MemberInquiryWithdrawalHandler implements UserLifecycleSyncHandler {
  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'withdrawn') {
      return Promise.resolve([]);
    }
    return Promise.resolve([
      db
        .update(memberInquiries)
        .set({ deletedAt: event.occurredAt, updatedAt: event.occurredAt })
        .where(
          and(
            eq(memberInquiries.userId, event.userId),
            notDeleted(memberInquiries.deletedAt),
          ),
        ),
    ]);
  }
}
