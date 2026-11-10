import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { ProductLifecycleEvent } from '../../../lib/core/product/product-lifecycle.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import type { SearchIndexStatements } from '../../../lib/workers/search/search-index-statements.ts';
import { PRODUCT_SEARCH_TARGET } from '../../../lib/workers/search/targets/product.ts';
import type { ProductLifecycleSyncHandler } from '../product/product-lifecycle-sync-handler.ts';

// 非公開化と削除の後に検索へ残さないため、確定と同じ一括の書き込みで消す。作り直しは確定の後の非同期の更新に任せるため、復元では文を返さない
@injectable()
export class ProductIndexRemovalSyncHandler implements ProductLifecycleSyncHandler {
  constructor(
    @inject(SEARCH_TYPES.IndexStatements)
    private readonly indexStatements: SearchIndexStatements,
  ) {}

  statementsFor(
    event: ProductLifecycleEvent,
  ): Promise<readonly BatchItem<'sqlite'>[]> {
    if (event.type !== 'hidden' && event.type !== 'deleted') {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      this.indexStatements.deleteSources(PRODUCT_SEARCH_TARGET.name, [
        event.productId,
      ]),
    );
  }
}
