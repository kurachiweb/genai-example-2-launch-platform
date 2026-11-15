import { and, count, desc, eq, isNull, lt, or, type SQL } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { notDeleted } from '../../../db/schema/_shared/columns.ts';
import { users } from '../../../db/schema/identity/users.ts';
import { productCategories } from '../../../db/schema/product/product-categories.ts';
import { products } from '../../../db/schema/product/products.ts';
import {
  visibleProducts,
  wonLaunchExists,
} from '../../../db/schema/product/visibility.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  productSummaryColumns,
  toProductSummaryRecord,
} from '../../../lib/workers/product/product-summary-columns.ts';
import type {
  LaunchHistoryProductRecord,
  LaunchHistoryScope,
  LaunchHistoryStore,
  ProductListPosition,
} from '../../application/product/ports.ts';

// 本人向けは停止中の投稿者のプロダクトも返すため、投稿者の状態を条件にしない
function scopeCondition(
  userId: string,
  scope: LaunchHistoryScope,
): SQL | undefined {
  const owned = eq(products.userId, userId);
  switch (scope) {
    case 'owner':
      return and(
        owned,
        notDeleted(products.deletedAt),
        isNull(products.hiddenAt),
      );
    case 'public':
      return and(owned, visibleProducts(), wonLaunchExists());
  }
}

function positionCondition(
  before: ProductListPosition | undefined,
): SQL | undefined {
  if (before === undefined) {
    return undefined;
  }
  return or(
    lt(products.latestLaunchDate, before.latestLaunchDate),
    and(
      eq(products.latestLaunchDate, before.latestLaunchDate),
      lt(products.id, before.id),
    ),
  );
}

@injectable()
export class D1LaunchHistoryStore implements LaunchHistoryStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async count(input: {
    readonly userId: string;
    readonly scope: LaunchHistoryScope;
  }): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(products)
      .innerJoin(users, eq(users.id, products.userId))
      .where(scopeCondition(input.userId, input.scope));
    return row?.total ?? 0;
  }

  async list(input: {
    readonly userId: string;
    readonly scope: LaunchHistoryScope;
    readonly limit: number;
    readonly before: ProductListPosition | undefined;
  }): Promise<readonly LaunchHistoryProductRecord[]> {
    const rows = await this.db
      .select({
        ...productSummaryColumns(),
        latestLaunchDate: products.latestLaunchDate,
      })
      .from(products)
      .innerJoin(users, eq(users.id, products.userId))
      .innerJoin(
        productCategories,
        eq(productCategories.id, products.categoryId),
      )
      .where(
        and(
          scopeCondition(input.userId, input.scope),
          positionCondition(input.before),
        ),
      )
      .orderBy(desc(products.latestLaunchDate), desc(products.id))
      .limit(input.limit);
    return rows.map((row) => ({
      ...toProductSummaryRecord(row),
      latestLaunchDate: parseBusinessDate(row.latestLaunchDate),
    }));
  }
}
