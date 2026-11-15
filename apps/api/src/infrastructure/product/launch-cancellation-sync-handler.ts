import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';

// ローンチ日が今日のローンチはマッチ中のため取り消さず、マッチの終了と結果の記録に任せる。停止の解除では取消を戻さない
@injectable()
export class LaunchCancellationSyncHandler implements UserLifecycleSyncHandler {
  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'suspended') {
      return Promise.resolve([]);
    }
    return Promise.resolve([
      db
        .update(productLaunches)
        .set({ cancelledAt: event.occurredAt, updatedAt: event.occurredAt })
        .where(
          and(
            isNull(productLaunches.outcome),
            isNull(productLaunches.cancelledAt),
            gt(
              productLaunches.launchDate,
              toBusinessDateTime(event.occurredAt).date,
            ),
            inArray(
              productLaunches.productId,
              db
                .select({ id: products.id })
                .from(products)
                .where(
                  and(
                    eq(products.userId, event.userId),
                    notDeleted(products.deletedAt),
                  ),
                ),
            ),
          ),
        ),
    ]);
  }
}
