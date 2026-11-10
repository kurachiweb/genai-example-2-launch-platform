import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import { accountIndexRemovalStatement } from '../../../lib/workers/directory/product-index-removal-statements.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';

// 退会と停止の後に検索へ残さないため、確定と同じ一括の書き込みで消す。作り直しは確定の後の非同期の更新に任せるため、停止の解除では文を返さない
@injectable()
export class AccountIndexRemovalSyncHandler implements UserLifecycleSyncHandler {
  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'withdrawn' && event.type !== 'suspended') {
      return Promise.resolve([]);
    }
    return Promise.resolve([accountIndexRemovalStatement(db, event.userId)]);
  }
}
