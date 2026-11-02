import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from './users.ts';

export const userLoginChallenges = snakeCase.table(
  'user_login_challenges',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id),
    tokenHash: text().notNull().unique(),
    expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('user_login_challenges_expires_at_idx').on(table.expiresAt),
  ],
);
