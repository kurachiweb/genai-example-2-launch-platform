import { eq } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { apiKeys } from '../../../db/schema/public-api/api-keys.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';

// 停止の解除の後もキーを使い続けられるよう、停止では消さず退会だけを扱う
@injectable()
export class ApiKeyErasureSyncHandler implements UserLifecycleSyncHandler {
  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'withdrawn') {
      return Promise.resolve([]);
    }
    return Promise.resolve([
      db.delete(apiKeys).where(eq(apiKeys.userId, event.userId)),
    ]);
  }
}
