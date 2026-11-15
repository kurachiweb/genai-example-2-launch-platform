import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { admins } from './admins.ts';

export const adminSessions = snakeCase.table(
  'admin_sessions',
  {
    id: ulidPrimaryKey(),
    adminId: text()
      .notNull()
      .references(() => admins.id),
    tokenHash: text().notNull().unique(),
    userAgent: text(),
    lastUsedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    absoluteExpiresAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('admin_sessions_admin_id_idx').on(table.adminId),
    index('admin_sessions_last_used_at_idx').on(table.lastUsedAt),
    index('admin_sessions_absolute_expires_at_idx').on(table.absoluteExpiresAt),
  ],
);
