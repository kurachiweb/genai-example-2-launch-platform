import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

// 集計値だけを持ち、他の機能の行を指さないため外部キーを張らない。収益は返金とチャージバックで負になり得るため符号を限らない
export const moderationWeeklyStatistics = snakeCase.table(
  'moderation_weekly_statistics',
  {
    id: ulidPrimaryKey(),
    weekStart: text().notNull(),
    netRevenue: integer().notNull(),
    usersTotal: integer().notNull(),
    productsTotal: integer().notNull(),
    qualifierMatches: integer().notNull(),
    upvotes: integer().notNull(),
    finalized: integer({ mode: 'boolean' }).notNull(),
    computedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('moderation_weekly_statistics_week_start_unique').on(
      table.weekStart,
    ),
    check(
      'moderation_weekly_statistics_finalized_check',
      sql`${table.finalized} in (0, 1)`,
    ),
    check(
      'moderation_weekly_statistics_users_total_check',
      sql`${table.usersTotal} >= 0`,
    ),
    check(
      'moderation_weekly_statistics_products_total_check',
      sql`${table.productsTotal} >= 0`,
    ),
    check(
      'moderation_weekly_statistics_qualifier_matches_check',
      sql`${table.qualifierMatches} >= 0`,
    ),
    check(
      'moderation_weekly_statistics_upvotes_check',
      sql`${table.upvotes} >= 0`,
    ),
  ],
);
