import { index, integer, snakeCase, text } from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

export const emailSendRecords = snakeCase.table(
  'email_send_records',
  {
    id: ulidPrimaryKey(),
    kind: text().notNull(),
    sentAt: integer({ mode: 'timestamp_ms' }).notNull(),
    ...timestamps(),
  },
  (table) => [index('email_send_records_sent_at_idx').on(table.sentAt)],
);
