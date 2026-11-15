import { inject, injectable } from 'inversify';

import { PRODUCT_CATEGORY_OTHER_ID } from '../../../common-lib/product/product-category-constants.ts';
import { DIRECTORY_PLATFORM_TYPES } from '../../../lib/core/directory/identifiers.ts';
import type { DirectoryListingQuery } from '../../../lib/core/directory/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type {
  ProductCategoryDirectory,
  ProductCategoryRecord,
} from '../../../lib/core/product/ports.ts';

export interface DirectoryCategoryReader {
  // 掲載中のプロダクトの数が多い順・同数は名称順で、「その他」を末尾に置く。掲載の無いカテゴリも含む
  list(): Promise<readonly ProductCategoryRecord[]>;
}

const NAME_COLLATOR = new Intl.Collator('ja');

@injectable()
export class CountedDirectoryCategoryReader implements DirectoryCategoryReader {
  constructor(
    @inject(PRODUCT_PLATFORM_TYPES.ProductCategoryDirectory)
    private readonly categories: ProductCategoryDirectory,
    @inject(DIRECTORY_PLATFORM_TYPES.DirectoryListingQuery)
    private readonly listing: DirectoryListingQuery,
  ) {}

  async list(): Promise<readonly ProductCategoryRecord[]> {
    const [categories, counts] = await Promise.all([
      this.categories.list(),
      this.listing.countByCategory(),
    ]);
    const countOf = (category: ProductCategoryRecord): number =>
      counts.get(category.id) ?? 0;
    const lastRankOf = (category: ProductCategoryRecord): number =>
      category.id === PRODUCT_CATEGORY_OTHER_ID ? 1 : 0;
    return categories.toSorted(
      (a, b) =>
        lastRankOf(a) - lastRankOf(b) ||
        countOf(b) - countOf(a) ||
        NAME_COLLATOR.compare(a.name, b.name) ||
        a.id.localeCompare(b.id),
    );
  }
}
