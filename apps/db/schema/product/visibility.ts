import { eq, isNull, sql, type SQL } from 'drizzle-orm';

import { notDeleted } from '../_shared/columns.ts';
import { visibleUsers } from '../identity/visibility.ts';
import { productLaunches } from './product-launches.ts';
import { products } from './products.ts';

// 投稿者の状態を見るため、問い合わせがproductsとusersを結合している前提で使う
export function visibleProducts(): SQL {
  return sql`(${notDeleted(products.deletedAt)} and ${isNull(products.hiddenAt)} and ${visibleUsers()})`;
}

export function wonLaunchExists(): SQL {
  return sql`exists (select 1 from ${productLaunches} where ${eq(productLaunches.productId, products.id)} and ${eq(productLaunches.outcome, 'won')} and ${isNull(productLaunches.cancelledAt)})`;
}

export function productInCategory(categoryId: string): SQL {
  return eq(products.categoryId, categoryId);
}
