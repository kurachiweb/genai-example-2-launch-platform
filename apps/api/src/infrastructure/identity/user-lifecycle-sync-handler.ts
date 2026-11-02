import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type {
  SyncLifecycleEventType,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';

// 状態の遷移と同じ一括の書き込みに入る文を返す。読み取りはしてよいが、書き込みは返す文だけで行い、利用者IDを条件にした集合に対する更新にする
export interface UserLifecycleSyncHandler {
  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]>;
}

export interface UserLifecycleSyncRegistration {
  // <spec名>.<名詞句>
  readonly name: string;
  readonly events: readonly SyncLifecycleEventType[];
  readonly handler: ServiceIdentifier<UserLifecycleSyncHandler>;
}
