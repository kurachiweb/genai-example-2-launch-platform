import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { users } from './users.ts';

export const userTotpCredentials = snakeCase.table(
  'user_totp_credentials',
  {
    id: ulidPrimaryKey(),
    userId: text()
      .notNull()
      .unique()
      .references(() => users.id),
    sealedSecret: text().notNull(),
    enabledAt: integer({ mode: 'timestamp_ms' }),
    pendingExpiresAt: integer({ mode: 'timestamp_ms' }),
    lastUsedStep: integer(),
    ...timestamps(),
  },
  (table) => [
    index('user_totp_credentials_pending_expires_at_idx').on(
      table.pendingExpiresAt,
    ),
  ],
);
