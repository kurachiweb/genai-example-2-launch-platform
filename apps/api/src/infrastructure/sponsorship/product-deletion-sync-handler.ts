import { and, eq, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { sponsorships } from '../../../db/schema/sponsorship/sponsorships.ts';
import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import type { ProductLifecycleSyncHandler } from '../product/product-lifecycle-sync-handler.ts';
import { waivedStopRefundStatus } from './stop-refund-waiver.ts';

// 申込は申込者のものとして論理削除せず、プロダクトの論理削除の日時だけを記録する。退会によるプロダクトの論理削除ではdeletedは起きず、退会の同期の処理が扱う
@injectable()
export class ProductDeletionSyncHandler implements ProductLifecycleSyncHandler {
  statementsFor(
    event: ProductLifecycleEvent,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'deleted') {
      return Promise.resolve([]);
    }
    return Promise.resolve([
      db
        .update(sponsorships)
        .set({
          productDeletedAt: event.occurredAt,
          stopRefundStatus: waivedStopRefundStatus(),
          updatedAt: event.occurredAt,
        })
        .where(
          and(
            eq(sponsorships.productId, event.productId),
            isNull(sponsorships.productDeletedAt),
          ),
        ),
    ]);
  }
}
