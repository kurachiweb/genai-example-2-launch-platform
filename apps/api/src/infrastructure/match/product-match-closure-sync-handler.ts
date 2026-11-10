import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { ProductLifecycleSyncHandler } from '../product/product-lifecycle-sync-handler.ts';
import { matchClosureStatements } from './match-closure-statements.ts';

// 復元では即時の終了・該当の記録を元に戻さないため、非公開化と削除だけを扱う。Upvoteは利用者のものとして残す
@injectable()
export class ProductMatchClosureSyncHandler implements ProductLifecycleSyncHandler {
  statementsFor(
    event: ProductLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'hidden' && event.type !== 'deleted') {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      matchClosureStatements(db, {
        subject: { kind: 'product', productId: event.productId },
        upvotes: 'none',
        at: event.occurredAt,
      }),
    );
  }
}
