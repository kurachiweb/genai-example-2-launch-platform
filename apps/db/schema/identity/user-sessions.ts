import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from './users.ts';

export const userSessions = snakeCase.table(
  'user_sessions',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    tokenHash: text().notNull().unique(),
    userAgent: text(),
    lastUsedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    absoluteExpiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('user_sessions_user_id_idx').on(table.userId),
    index('user_sessions_last_used_at_idx').on(table.lastUsedAt),
    index('user_sessions_absolute_expires_at_idx').on(table.absoluteExpiresAt),
  ],
);
