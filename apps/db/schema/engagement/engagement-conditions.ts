import { isNotNull, isNull, sql, type SQL } from 'drizzle-orm';

import { notDeleted } from '../_shared/columns.ts';
import { visibleUsers } from '../identity/visibility.ts';
import { launchComments } from './launch-comments.ts';
import { productRatings } from './product-ratings.ts';

// 匿名化で投稿者が外れた行も置き換え表示として返すため、問い合わせがusersをauthor_user_idで外部結合している前提で使う
export function displayableComment(): SQL {
  return sql`(${notDeleted(launchComments.deletedAt)} and ${isNull(launchComments.hiddenAt)} and ${isNull(launchComments.anonymizedAt)} and ${isNotNull(launchComments.authorUserId)} and ${visibleUsers()})`;
}

// 評価者の状態を見るため、問い合わせがusersをuser_idで内部結合している前提で使う
export function validRating(): SQL {
  return sql`(${isNull(productRatings.invalidatedAt)} and ${notDeleted(productRatings.deletedAt)} and ${visibleUsers()})`;
}
