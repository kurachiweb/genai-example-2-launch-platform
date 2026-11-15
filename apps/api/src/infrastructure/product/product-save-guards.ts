import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import { users } from '../../../db/schema/identity/users.ts';
import {
  verifiedUsers,
  visibleUsers,
} from '../../../db/schema/identity/visibility.ts';
import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { products } from '../../../db/schema/product/products.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import { handleOccupiedCondition } from '../../../lib/workers/handles/handle-queries.ts';
import { PRODUCT_HANDLE_NAMESPACE } from '../../../lib/workers/product/product-handle-namespaces.ts';

// 投稿者のIDは、既存の行を更新する文では列、挿入する文では値で渡す
type OwnerReference = SQLiteColumn | string;

function ownerWritable(owner: OwnerReference): SQL {
  return sql`EXISTS (SELECT 1 FROM ${users} WHERE ${eq(users.id, owner)} AND ${visibleUsers()})`;
}

function ownerVerified(owner: OwnerReference): SQL {
  return sql`EXISTS (SELECT 1 FROM ${users} WHERE ${eq(users.id, owner)} AND ${verifiedUsers()})`;
}

function versionMatches(expected: number): SQL {
  return eq(products.version, expected);
}

function notDeleted(): SQL {
  return isNull(products.deletedAt);
}

function notHidden(): SQL {
  return isNull(products.hiddenAt);
}

// 閾値は`qualifierLockThresholdDate(now)`。書き込みの時点の日付で判定するため、読み取りの後に23:45をまたいでも固定が破られない
function qualifierUnlocked(thresholdDate: BusinessDate): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${productLaunches} WHERE ${and(
    eq(productLaunches.productId, products.id),
    isNull(productLaunches.outcome),
    isNull(productLaunches.cancelledAt),
    sql`${productLaunches.launchDate} <= ${thresholdDate}`,
  )})`;
}

// ローンチ日の変更の対象が、読み取りの後に結果の記録や取消で閉じていないこと
function launchOpen(launchId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM ${productLaunches} WHERE ${and(
    eq(productLaunches.id, launchId),
    eq(productLaunches.productId, products.id),
    isNull(productLaunches.outcome),
    isNull(productLaunches.cancelledAt),
  )})`;
}

function handleFree(handle: string, exceptProductId?: string): SQL {
  return sql`NOT ${handleOccupiedCondition(
    PRODUCT_HANDLE_NAMESPACE,
    handle,
    exceptProductId === undefined ? {} : { exceptOwnerId: exceptProductId },
  )}`;
}

// 保存・登録・削除・ライフサイクルの確定で、NOT NULLの列へ入れるCASE式の条件と、取り消しの理由の読み直しに使う
export const PRODUCT_SAVE_GUARDS = Object.freeze({
  ownerWritable,
  ownerVerified,
  versionMatches,
  notDeleted,
  notHidden,
  qualifierUnlocked,
  launchOpen,
  handleFree,
});
