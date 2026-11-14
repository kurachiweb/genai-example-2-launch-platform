import { asc, eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  ProductCategoryDirectory,
  ProductCategoryRecord,
} from '../../core/product/ports.ts';

const CATEGORY_COLUMNS = {
  id: productCategories.id,
  name: productCategories.name,
  handle: productCategories.handle,
  systemDefault: productCategories.systemDefault,
  createdAt: productCategories.createdAt,
};

@injectable()
export class D1ProductCategoryDirectory implements ProductCategoryDirectory {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async list(): Promise<readonly ProductCategoryRecord[]> {
    return this.db
      .select(CATEGORY_COLUMNS)
      .from(productCategories)
      .orderBy(
        asc(productCategories.systemDefault),
        asc(productCategories.createdAt),
        asc(productCategories.id),
      );
  }

  // 列のNOCASE照合に任せて大文字小文字を区別せずに一意索引で引く
  async findByHandle(
    handle: string,
  ): Promise<ProductCategoryRecord | undefined> {
    const [row] = await this.db
      .select(CATEGORY_COLUMNS)
      .from(productCategories)
      .where(eq(productCategories.handle, handle))
      .limit(1);
    return row;
  }
}
