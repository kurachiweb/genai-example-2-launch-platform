import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  snakeCase,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { softDelete, timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from '../identity/users.ts';
import { matchEntries } from './match-entries.ts';
import { matches } from './matches.ts';

export const matchUpvotes = snakeCase.table(
  'match_upvotes',
  {
    id: ulidPrimaryKey(),
    matchId: text()
      .notNull()
      .references(() => matches.id),
    entryId: text()
      .notNull()
      .references(() => matchEntries.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    matchDate: text().notNull(),
    upvotedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    seq: integer().notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    uniqueIndex('match_upvotes_match_id_user_id_active_unique')
      .on(table.matchId, table.userId)
      .where(sql`${table.deletedAt} is null`),
    index('match_upvotes_entry_id_deleted_at_upvoted_at_seq_idx').on(
      table.entryId,
      table.deletedAt,
      table.upvotedAt,
      table.seq,
    ),
    index('match_upvotes_user_id_deleted_at_match_date_upvoted_at_id_idx').on(
      table.userId,
      table.deletedAt,
      table.matchDate,
      table.upvotedAt,
      table.id,
    ),
    index('match_upvotes_match_id_seq_idx').on(table.matchId, table.seq),
  ],
);
