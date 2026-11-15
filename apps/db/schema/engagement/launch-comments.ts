import { between } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';
import { productLaunches } from '../product/product-launches.ts';
import { products } from '../product/products.ts';

// common-libのengagement/engagement-rules.tsのCOMMENT_MAX_DEPTHの写しで(apps/dbはcommon-libを読み込まない)、一致はルートのconfig/engagement-contract-copies.unit.test.tsが確かめる
const COMMENT_MAX_DEPTH = 3;

const TOP_LEVEL_DEPTH = 1;

export const launchComments = snakeCase.table(
  'launch_comments',
  {
    id: ulidPrimaryKey(),
    productId: text()
      .notNull()
      .references(() => products.id),
    launchId: text()
      .notNull()
      .references(() => productLaunches.id),
    parentId: text().references((): AnySQLiteColumn => launchComments.id),
    // トップレベルは挿入の時点で自身のIDを持つため、外部キーにしない
    rootId: text().notNull(),
    depth: integer().notNull(),
    authorUserId: text().references(() => users.id),
    body: text().notNull(),
    editedAt: integer({ mode: 'timestamp_ms' }),
    hiddenAt: integer({ mode: 'timestamp_ms' }),
    anonymizedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
    ...softDelete(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    index('launch_comments_launch_id_depth_created_at_id_idx').on(
      table.launchId,
      table.depth,
      table.createdAt,
      table.id,
    ),
    index('launch_comments_root_id_created_at_id_idx').on(
      table.rootId,
      table.createdAt,
      table.id,
    ),
    index('launch_comments_author_user_id_idx').on(table.authorUserId),
    index('launch_comments_product_id_idx').on(table.productId),
    index('launch_comments_deleted_at_idx').on(table.deletedAt),
    check(
      'launch_comments_depth_check',
      between(table.depth, TOP_LEVEL_DEPTH, COMMENT_MAX_DEPTH).inlineParams(),
    ),
  ],
);
