import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';
import { textNoCase } from '../_shared/text-no-case.ts';

export const emailSuppressions = snakeCase.table(
  'email_suppressions',
  {
    id: ulidPrimaryKey(),
    address: textNoCase().notNull().unique(),
    lastReason: text({
      enum: ['hard_bounce', 'complaint', 'rejected'],
    }).notNull(),
    lastEventAt: integer({ mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  (table) => [
    index('email_suppressions_last_event_at_idx').on(table.lastEventAt),
    index('email_suppressions_expires_at_idx').on(table.expiresAt),
  ],
);
