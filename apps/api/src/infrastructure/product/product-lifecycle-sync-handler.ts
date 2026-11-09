import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type {
  ProductLifecycleEvent,
  SyncProductLifecycleEventType,
} from '../../../lib/core/product/product-lifecycle.ts';

// 状態の変更と同じ一括の書き込みに入る文を返す。読み取りはしてよいが、書き込みは返す文だけで行い、プロダクトIDを条件にした集合に対する更新にする
export interface ProductLifecycleSyncHandler {
  statementsFor(
    event: ProductLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]>;
}

export interface ProductLifecycleSyncRegistration {
  // <spec名>.<名詞句>
  readonly name: string;
  readonly events: readonly SyncProductLifecycleEventType[];
  readonly handler: ServiceIdentifier<ProductLifecycleSyncHandler>;
}
