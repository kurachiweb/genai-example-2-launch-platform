import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import { DIRECTORY_PLATFORM_TYPES } from '../../../lib/core/directory/identifiers.ts';
import type { DirectoryEntryStore } from '../../../lib/core/directory/ports.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import type { SearchIndexRefreshRequester } from '../../../lib/core/search/ports.ts';
import type { SearchIndexStatements } from '../../../lib/workers/search/search-index-statements.ts';
import { PRODUCT_SEARCH_TARGET } from '../../../lib/workers/search/targets/product.ts';
import type {
  ProductSaveAfterCommitInput,
  ProductSaveHook,
  ProductSaveStatementsInput,
} from '../product/product-save-hooks.ts';

// 索引文書を持ち得るのは予選で勝ったプロダクトだけのため、勝利したプロダクトの記録があるときだけ更新待ちにする。掲載中かどうかは索引の更新の処理が判定する
@injectable()
export class ProductIndexRefreshSaveHook implements ProductSaveHook {
  constructor(
    @inject(DIRECTORY_PLATFORM_TYPES.DirectoryEntryStore)
    private readonly entries: DirectoryEntryStore,
    @inject(SEARCH_TYPES.IndexStatements)
    private readonly indexStatements: SearchIndexStatements,
    @inject(SEARCH_TYPES.RefreshRequester)
    private readonly refreshRequester: SearchIndexRefreshRequester,
  ) {}

  async statementsFor({
    productId,
    at,
  }: ProductSaveStatementsInput): Promise<readonly BatchItem<'sqlite'>[]> {
    if (!(await this.entries.exists(productId))) {
      return [];
    }
    return [
      this.indexStatements.markPending(
        PRODUCT_SEARCH_TARGET.name,
        productId,
        at,
      ),
    ];
  }

  async afterCommit({ productId }: ProductSaveAfterCommitInput): Promise<void> {
    if (!(await this.entries.exists(productId))) {
      return;
    }
    await this.refreshRequester.requestRefresh(
      PRODUCT_SEARCH_TARGET.name,
      productId,
    );
  }
}
