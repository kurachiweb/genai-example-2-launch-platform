import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { admins } from './admins.ts';

export const adminTotpCredentials = snakeCase.table(
  'admin_totp_credentials',
  {
    id: ulidPrimaryKey(),
    adminId: text()
      .notNull()
      .unique()
      .references(() => admins.id),
    sealedSecret: text(),
    enabledAt: integer({ mode: 'timestamp_ms' }),
    lastUsedStep: integer(),
    pendingSealedSecret: text(),
    pendingExpiresAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  (table) => [
    index('admin_totp_credentials_pending_expires_at_idx').on(
      table.pendingExpiresAt,
    ),
  ],
);
