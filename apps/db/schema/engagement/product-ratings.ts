import { inArray } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';
import { products } from '../product/products.ts';

// common-libのengagement/engagement-rules.tsのRATING_SCORESの写しで(apps/dbはcommon-libを読み込まない)、一致はルートのconfig/engagement-contract-copies.unit.test.tsが確かめる
const RATING_SCORES = [1, 2, 3, 4, 5] as const;

export const productRatings = snakeCase.table(
  'product_ratings',
  {
    id: ulidPrimaryKey(),
    productId: text()
      .notNull()
      .references(() => products.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    score: integer().notNull(),
    invalidatedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
    ...softDelete(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('product_ratings_product_id_user_id_unique').on(
      table.productId,
      table.userId,
    ),
    index('product_ratings_user_id_idx').on(table.userId),
    check(
      'product_ratings_score_check',
      inArray(table.score, RATING_SCORES).inlineParams(),
    ),
  ],
);
