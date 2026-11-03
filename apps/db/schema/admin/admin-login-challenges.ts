import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { admins } from './admins.ts';

export const adminLoginChallenges = snakeCase.table(
  'admin_login_challenges',
  {
    id: ulidPrimaryKey(),
    adminId: text()
      .notNull()
      .references(() => admins.id),
    tokenHash: text().notNull().unique(),
    expiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('admin_login_challenges_expires_at_idx').on(table.expiresAt),
  ],
);
