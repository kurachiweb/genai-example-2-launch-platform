import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { productPreviousHandles } from '../../../db/schema/product/product-previous-handles.ts';
import { products } from '../../../db/schema/product/products.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { UserLifecycleSyncHandler } from '../identity/user-lifecycle-sync-handler.ts';

// ローンチの照会はプロダクトのdeleted_atで絞るため、ローンチの行は変えずにプロダクトの論理削除に従わせる
@injectable()
export class ProductWithdrawalSyncHandler implements UserLifecycleSyncHandler {
  statementsFor(
    event: UserLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'withdrawn') {
      return Promise.resolve([]);
    }
    return Promise.resolve([
      db
        .update(products)
        .set({
          deletedAt: event.occurredAt,
          version: sql`${products.version} + 1`,
          updatedAt: event.occurredAt,
        })
        .where(
          and(
            eq(products.userId, event.userId),
            notDeleted(products.deletedAt),
          ),
        ),
      db
        .update(productPreviousHandles)
        .set({ deletedAt: event.occurredAt, updatedAt: event.occurredAt })
        .where(
          and(
            notDeleted(productPreviousHandles.deletedAt),
            inArray(
              productPreviousHandles.ownerId,
              db
                .select({ id: products.id })
                .from(products)
                .where(eq(products.userId, event.userId)),
            ),
          ),
        ),
    ]);
  }
}
