import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';
import { matchClosureStatements } from './match-closure-statements.ts';

// 停止の解除では論理削除したUpvote・即時の終了・該当の記録を元に戻さないため、退会と停止だけを扱う
@injectable()
export class AccountMatchClosureSyncHandler implements UserLifecycleSyncHandler {
  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'withdrawn' && event.type !== 'suspended') {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      matchClosureStatements(db, {
        subject: { kind: 'user', userId: event.userId },
        upvotes: event.type === 'withdrawn' ? 'all' : 'live',
        at: event.occurredAt,
      }),
    );
  }
}
