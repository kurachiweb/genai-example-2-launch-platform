import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import type { SearchIndexStatements } from '../../../lib/workers/search/search-index-statements.ts';
import { PRODUCT_SEARCH_TARGET } from '../../../lib/workers/search/targets/product.ts';
import {
  MAX_PRODUCTS_PER_PENDING_MARK,
  type ProductIndexPendingMarker,
} from '../../application/directory/ports.ts';

@injectable()
export class D1ProductIndexPendingMarker implements ProductIndexPendingMarker {
  constructor(
    @inject(PLATFORM_TYPES.Database) private readonly db: Database,
    @inject(SEARCH_TYPES.IndexStatements)
    private readonly statements: SearchIndexStatements,
  ) {}

  async mark(productIds: readonly string[], at: Date): Promise<void> {
    if (productIds.length > MAX_PRODUCTS_PER_PENDING_MARK) {
      throw new RangeError(
        `索引文書を更新待ちにするプロダクトは1回に${String(MAX_PRODUCTS_PER_PENDING_MARK)}件以内にしてください。`,
      );
    }
    const [first, ...rest] = productIds.map((productId) =>
      this.statements.markPending(PRODUCT_SEARCH_TARGET.name, productId, at),
    );
    if (first === undefined) {
      return;
    }
    await this.db.batch([first, ...rest]);
  }
}
