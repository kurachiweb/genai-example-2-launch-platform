import { inArray, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { productLaunches } from '../product/product-launches.ts';
import { products } from '../product/products.ts';
import { matches } from './matches.ts';

const ENTRY_RESULTS = ['won', 'lost', 'bye', 'walkover'] as const;

export const matchEntries = snakeCase.table(
  'match_entries',
  {
    id: ulidPrimaryKey(),
    matchId: text()
      .notNull()
      .references(() => matches.id),
    slot: integer().notNull(),
    matchKind: text({ enum: matches.kind.enumValues }).notNull(),
    matchDate: text().notNull(),
    launchId: text().references(() => productLaunches.id),
    productId: text().references(() => products.id),
    // 投稿者の物理削除を妨げないため外部キーにしない
    ownerUserId: text(),
    upvoteCount: integer().notNull().default(0),
    lastUpvotedAt: integer({ mode: 'timestamp_ms' }),
    lastUpvoteSeq: integer(),
    forfeitedAt: integer({ mode: 'timestamp_ms' }),
    result: text({ enum: ENTRY_RESULTS }),
    unlinkedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションの部分索引とCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    uniqueIndex('match_entries_match_id_slot_unique').on(
      table.matchId,
      table.slot,
    ),
    uniqueIndex('match_entries_qualifier_launch_id_unique')
      .on(table.launchId)
      .where(
        sql`(${table.matchKind} = 'qualifier' and ${table.launchId} is not null)`,
      ),
    index('match_entries_product_id_idx').on(table.productId),
    index('match_entries_owner_user_id_idx').on(table.ownerUserId),
    index('match_entries_launch_id_idx').on(table.launchId),
    index('match_entries_match_kind_match_date_idx').on(
      table.matchKind,
      table.matchDate,
    ),
    check('match_entries_slot_check', sql`${table.slot} in (1, 2)`),
    check(
      'match_entries_match_kind_check',
      inArray(table.matchKind, matches.kind.enumValues).inlineParams(),
    ),
    check(
      'match_entries_result_check',
      inArray(table.result, ENTRY_RESULTS).inlineParams(),
    ),
  ],
);
