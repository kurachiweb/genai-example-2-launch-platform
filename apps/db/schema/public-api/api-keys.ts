import { inArray } from 'drizzle-orm';
import {
  check,
  index,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';

// common-libのpublic-api/api-key-rules.tsのREAD_LEVELS・WRITE_LEVELSの写しで(apps/dbはcommon-libを読み込まない)、一致はルートのconfig/public-api-contract-copies.unit.test.tsが確かめる
const READ_LEVELS = ['none', 'read'] as const;

const WRITE_LEVELS = ['none', 'read', 'read_write'] as const;

const readScope = () => text({ enum: READ_LEVELS }).notNull();

const writeScope = () => text({ enum: WRITE_LEVELS }).notNull();

export const apiKeys = snakeCase.table(
  'api_keys',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    name: text().notNull(),
    keyHash: text().notNull(),
    scopeProducts: readScope(),
    scopeLaunches: readScope(),
    scopeUpvotes: readScope(),
    scopeComments: readScope(),
    scopeRatings: readScope(),
    scopeProfile: writeScope(),
    scopeProductDescriptions: writeScope(),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('api_keys_key_hash_unique').on(table.keyHash),
    index('api_keys_user_id_created_at_id_idx').on(
      table.userId,
      table.createdAt,
      table.id,
    ),
    check(
      'api_keys_scope_products_check',
      inArray(table.scopeProducts, READ_LEVELS).inlineParams(),
    ),
    check(
      'api_keys_scope_launches_check',
      inArray(table.scopeLaunches, READ_LEVELS).inlineParams(),
    ),
    check(
      'api_keys_scope_upvotes_check',
      inArray(table.scopeUpvotes, READ_LEVELS).inlineParams(),
    ),
    check(
      'api_keys_scope_comments_check',
      inArray(table.scopeComments, READ_LEVELS).inlineParams(),
    ),
    check(
      'api_keys_scope_ratings_check',
      inArray(table.scopeRatings, READ_LEVELS).inlineParams(),
    ),
    check(
      'api_keys_scope_profile_check',
      inArray(table.scopeProfile, WRITE_LEVELS).inlineParams(),
    ),
    check(
      'api_keys_scope_product_descriptions_check',
      inArray(table.scopeProductDescriptions, WRITE_LEVELS).inlineParams(),
    ),
  ],
);
