import { sql } from 'drizzle-orm';
import {
  check,
  index,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';

export const userFollows = snakeCase.table(
  'user_follows',
  {
    id: ulidPrimaryKey(),
    followerId: text()
      .notNull()
      .references(() => users.id),
    followeeId: text()
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    uniqueIndex('user_follows_follower_id_followee_id_unique').on(
      table.followerId,
      table.followeeId,
    ),
    index('user_follows_follower_id_created_at_id_idx').on(
      table.followerId,
      table.createdAt,
      table.id,
    ),
    index('user_follows_followee_id_created_at_id_idx').on(
      table.followeeId,
      table.createdAt,
      table.id,
    ),
    check(
      'user_follows_not_self_check',
      sql`${table.followerId} <> ${table.followeeId}`,
    ),
  ],
);
